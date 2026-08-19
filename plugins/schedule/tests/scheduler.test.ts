import { Context } from "cordis";
import { clone, makeArray, pick } from "cosmokit";
import { Universal } from "koishi";
import type { EventRecord } from "koishi-plugin-yesimbot";
import { Database, Driver, Eval, executeEval, executeQuery, executeSort, executeUpdate, Field, RuntimeError, Selection } from "minato";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { MAX_CONCURRENT_TRIGGERS, ScheduleScheduler } from "../src/scheduler.js";
import { ScheduleStore, registerScheduleModel, type ScheduleScope } from "../src/store.js";
import type { Schedule } from "../src/types.js";

vi.mock("koishi", async () => import("@koishijs/core"));

const sharedScope = { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1", selfId: "bot-1" } satisfies ScheduleScope;

const T0 = "2026-08-01T00:00:00.000Z";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory Minato driver for this test file, modeled on the semantics
 * of `@minatojs/driver-memory`. It exercises the real minato query pipeline
 * (query parsing, sorting, field defaults) without adding a package dependency.
 */
class MemoryDriver extends Driver<Record<string, never>> {
  private store: Record<string, Row[]> = Object.create(null);
  private autoInc: Record<string, number> = Object.create(null);
  private indexes: Record<string, Record<string, Driver.Index>> = Object.create(null);

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}
  public async drop(table: string): Promise<void> {
    delete this.store[table];
  }
  public async dropAll(): Promise<void> {
    this.store = Object.create(null);
  }
  public async stats(): Promise<Driver.Stats> {
    const tables = Object.fromEntries(Object.entries(this.store).map(([name, rows]) => [name, { name, count: rows.length, size: 0 }]));
    return { tables, size: 0 };
  }
  public async prepare(): Promise<void> {}

  public table(sel: string | Selection.Immutable, env: Record<string, unknown> = {}): Row[] {
    if (typeof sel === "string") return (this.store[sel] ||= []);
    if (!Selection.is(sel)) throw new Error("unreachable selection");
    const { ref, query, table, model } = sel;
    const modifier = sel.args[0] ?? {};
    let data = this.table(table, env).filter((row) => executeQuery(row, query, ref));
    data = executeSort(data, modifier, ref);
    return data.map((row) => {
      row = model.format(row, false);
      for (const key in model.fields) {
        if (!Field.available(model.fields[key])) continue;
        row[key] ??= null;
      }
      return model.parse(row, false);
    });
  }

  public async get(sel: Selection.Immutable): Promise<unknown[]> {
    return this.table(sel);
  }

  public async eval(sel: Selection.Immutable, expr: Eval.Expr): Promise<unknown> {
    const { query, table } = sel;
    const ref = typeof table === "string" ? sel.ref : table.ref;
    const data = this.table(table).filter((row) => executeQuery(row, query, ref));
    return executeEval(
      data.map((row) => ({ [ref]: row, _: row })),
      expr,
    );
  }

  public async set(sel: Selection.Mutable, data: Record<string, unknown>): Promise<Driver.WriteResult> {
    const { ref, query, table } = sel;
    const matched = this.table(table)
      .filter((row) => executeQuery(row, query, ref))
      .map((row) => executeUpdate(row, data, ref)).length;
    return { matched };
  }

  public async remove(sel: Selection.Mutable): Promise<Driver.WriteResult> {
    const { ref, query, table } = sel;
    const data = this.table(table);
    this.store[table] = data.filter((row) => !executeQuery(row, query, ref));
    const removed = data.length - this.store[table].length;
    return { removed, matched: removed };
  }

  public async create(sel: Selection.Mutable, data: Record<string, unknown>): Promise<unknown> {
    const { table, model } = sel;
    const { primary, autoInc } = model;
    const store = this.table(table);
    if (!Array.isArray(primary) && autoInc && !(primary in data)) {
      this.autoInc[table] = (this.autoInc[table] ?? 0) + 1;
      data[primary] = this.autoInc[table];
    } else {
      const key = makeArray(primary)[0];
      const duplicated = await this.database.get(table, pick(model.format(data), [key]));
      if (duplicated.length) throw new RuntimeError("duplicate-entry");
    }
    store.push(clone(data));
    return clone(data);
  }

  public async upsert(sel: Selection.Mutable, data: Row[], keys: string[]): Promise<Driver.WriteResult> {
    const { table, model, ref } = sel;
    const result: Driver.WriteResult = { inserted: 0, matched: 0 };
    for (const update of data) {
      const row = this.table(table).find((row) => keys.every((key) => row[key] === update[key]));
      if (row) {
        executeUpdate(row, update, ref);
        result.matched = (result.matched ?? 0) + 1;
      } else {
        await this.create(sel, executeUpdate(model.create(), update, ref)).catch(() => {});
        result.inserted = (result.inserted ?? 0) + 1;
      }
    }
    return result;
  }

  public async withTransaction(callback: () => Promise<void>): Promise<void> {
    const data = clone(this.store);
    await callback().catch((error: unknown) => {
      this.store = data;
      throw error;
    });
  }

  public async getIndexes(table: string): Promise<Driver.Index[]> {
    return Object.values(this.indexes[table] ?? {});
  }

  public async createIndex(table: string, index: Driver.Index): Promise<void> {
    const name =
      index.name ??
      `index:${Object.entries(index.keys)
        .map(([key, dir]) => `${key}_${dir}`)
        .join("+")}`;
    this.indexes[table] ??= {};
    this.indexes[table][name] = { name, unique: false, ...index };
  }

  public async dropIndex(table: string, name: string): Promise<void> {
    this.indexes[table] ??= {};
    delete this.indexes[table][name];
  }
}

async function createScheduleDatabase(): Promise<{ ctx: Context; model: Database }> {
  const ctx = new Context();
  ctx.plugin(Database);
  await ctx.start();
  const model = ctx.model as Database;
  await model.connect(MemoryDriver, {});
  return { ctx, model };
}

describe("ScheduleScheduler", () => {
  let store: ScheduleStore;
  let trigger: Mock<(event: EventRecord) => Promise<void>>;
  let scheduler: ScheduleScheduler;

  beforeEach(async () => {
    const { model } = await createScheduleDatabase();
    registerScheduleModel(model);
    store = new ScheduleStore(model);
    trigger = vi.fn(async (_event: EventRecord) => {});
    scheduler = new ScheduleScheduler(store, { yesimbot: { messenger: { post: trigger } } } as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits one due once schedule exactly once with a complete due event", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    const created = await store.create(sharedScope, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: T0 });

    vi.setSystemTime(new Date(T0));
    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledTimes(1);
    const event = trigger.mock.calls[0][0];
    expect(event).toMatchObject({
      eventType: "schedule.due",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1", type: Universal.Channel.Type.TEXT },
      text: 'Schedule "standup" is due.\nPrepare the daily standup.',
      schedule: { id: created.id, title: "standup", kind: "once", scheduledFor: T0 },
    });
    expect(event.timestamp).toBe(Date.parse(T0));
    expect(trigger.mock.calls[0][1]).toEqual({ trigger: true, ifBusy: "defer", delivery: "channel" });

    const [updated] = await store.list(sharedScope);
    expect(updated.state).toBe("completed");
    expect(updated.nextRunAt).toBeNull();
    expect(updated.lastResult).toMatchObject({ occurrenceAt: T0, status: "accepted" });
  });

  it("runs a silent schedule without channel delivery", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    await store.create(sharedScope, { title: "memory maintenance", prompt: "Update memory without replying.", delivery: "silent", kind: "once", at: T0 });

    vi.setSystemTime(new Date(T0));
    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][1]).toEqual({ trigger: true, ifBusy: "defer", delivery: "silent" });
  });

  it("submits consecutive cron occurrences without overlap", async () => {
    const created = await store.create(sharedScope, { title: "quarterly", prompt: "Ping.", kind: "cron", cron: "*/15 * * * *" });
    expect(created.nextRunAt).toBe("2026-08-01T00:15:00.000Z");

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0].schedule.scheduledFor).toBe("2026-08-01T00:15:00.000Z");

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[1][0].schedule.scheduledFor).toBe("2026-08-01T00:30:00.000Z");

    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: "2026-08-01T00:30:00.000Z", status: "accepted" });
    expect(row.nextRunAt).toBe("2026-08-01T00:45:00.000Z");
  });

  it("recovers a missed cron occurrence without replaying it", async () => {
    const created = await store.create(sharedScope, { title: "quarterly", prompt: "Ping.", kind: "cron", cron: "*/15 * * * *" });
    expect(created.nextRunAt).toBe("2026-08-01T00:15:00.000Z");

    // Restart after the first occurrence has passed without a submission.
    vi.setSystemTime(new Date("2026-08-01T00:20:00.000Z"));
    await scheduler.start();

    expect(trigger).not.toHaveBeenCalled();
    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: "2026-08-01T00:15:00.000Z", status: "missed" });
    expect(row.state).toBe("enabled");
    expect(row.nextRunAt).toBe("2026-08-01T00:30:00.000Z");

    // The first future occurrence is still submitted exactly once.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0].schedule.scheduledFor).toBe("2026-08-01T00:30:00.000Z");
  });

  it("marks an interrupted claim on restart without resubmitting", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    const created = await store.create(sharedScope, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: T0 });

    // The durable claim happened, but the process stopped before the trigger result.
    const claimed = await store.claim(created.id, T0);
    expect(claimed?.lastResult).toMatchObject({ occurrenceAt: T0, status: "submitting" });

    vi.setSystemTime(new Date(Date.parse(T0) + 1_000));
    await scheduler.start();

    expect(trigger).not.toHaveBeenCalled();
    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: T0, status: "interrupted" });
    expect(row.state).toBe("completed");
    expect(row.nextRunAt).toBeNull();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("does not duplicate a trigger when the same occurrence is woken twice", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    const created = await store.create(sharedScope, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: T0 });

    vi.setSystemTime(new Date(T0));
    let release!: () => void;
    trigger.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(trigger).toHaveBeenCalledTimes(1);

    // A duplicate timer wake for the already-claimed occurrence must not trigger again.
    const withWake = scheduler as unknown as { wake(): Promise<void> };
    await withWake.wake();
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(await store.claim(created.id, T0)).toBeNull();

    release();
    await vi.advanceTimersByTimeAsync(0);
    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: T0, status: "accepted" });
  });

  it("records a due occurrence as missed when all five trigger slots are occupied", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    const created: Schedule[] = [];
    for (let i = 0; i < MAX_CONCURRENT_TRIGGERS + 1; i++) {
      created.push(await store.create(sharedScope, { title: `slot-${i}`, prompt: "Ping.", kind: "once", at: T0 }));
    }

    vi.setSystemTime(new Date(T0));
    const releases: Array<() => void> = [];
    trigger.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledTimes(MAX_CONCURRENT_TRIGGERS);
    let rows = await store.list(sharedScope);
    expect(rows.filter((row) => row.lastResult?.status === "submitting")).toHaveLength(MAX_CONCURRENT_TRIGGERS);
    const missed = rows.find((row) => row.lastResult?.status === "missed");
    expect(missed).toBeDefined();
    expect(missed!.lastResult).toMatchObject({ occurrenceAt: T0, status: "missed" });
    expect(missed!.state).toBe("completed");
    expect(missed!.nextRunAt).toBeNull();

    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(0);
    rows = await store.list(sharedScope);
    expect(rows.filter((row) => row.lastResult?.status === "accepted")).toHaveLength(MAX_CONCURRENT_TRIGGERS);
    expect(rows.filter((row) => row.lastResult?.status === "missed")).toHaveLength(1);
  });

  it("finalizes a rejected trigger as failed", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 3_600_000));
    const created = await store.create(sharedScope, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: T0 });

    vi.setSystemTime(new Date(T0));
    trigger.mockRejectedValueOnce(new Error("bot offline"));

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger.mock.calls[0][0].schedule.id).toBe(created.id);
    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: T0, status: "failed" });
    expect(row.lastResult?.error).toEqual({ name: "Error", message: "bot offline" });
    expect(row.state).toBe("completed");
  });

  it("stops arming future work after stop() while preserving rows", async () => {
    const created = await store.create(sharedScope, { title: "quarterly", prompt: "Ping.", kind: "cron", cron: "*/15 * * * *" });
    expect(created.nextRunAt).toBe("2026-08-01T00:15:00.000Z");

    await scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(trigger).not.toHaveBeenCalled();
    const [row] = await store.list(sharedScope);
    expect(row.state).toBe("enabled");
    expect(row.nextRunAt).toBe("2026-08-01T00:15:00.000Z");
    expect(row.lastResult).toBeUndefined();
  });

  it("rearms a long delay in bounded chunks without submitting early", async () => {
    const dueAt = new Date(Date.parse(T0) + 0x7fffffff + 60_000).toISOString();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.setSystemTime(new Date(Date.parse(T0) - 1));
    await store.create(sharedScope, { title: "far future", prompt: "Wait.", kind: "once", at: dueAt });

    vi.setSystemTime(new Date(T0));
    await scheduler.start();
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 0x7fffffff);
    await vi.advanceTimersByTimeAsync(0x7fffffff);

    expect(trigger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(trigger).toHaveBeenCalledOnce();
  });

  it("does not submit an occurrence claimed before stop and records it as interrupted", async () => {
    vi.setSystemTime(new Date(Date.parse(T0) - 60_000));
    const created = await store.create(sharedScope, { title: "shutdown", prompt: "Do not send.", kind: "once", at: T0 });
    const originalClaim = store.claim.bind(store);
    const claimed = new Promise<void>((resolve) => {
      vi.spyOn(store, "claim").mockImplementation(async (id, occurrenceAt) => {
        const row = await originalClaim(id, occurrenceAt);
        resolve();
        await new Promise<void>((release) => (releaseClaim = release));
        return row;
      });
    });
    let releaseClaim!: () => void;

    vi.setSystemTime(new Date(T0));
    await scheduler.start();
    const withWake = scheduler as unknown as { wake(): Promise<void> };
    const wake = withWake.wake();
    await claimed;
    scheduler.stop();
    releaseClaim();
    await wake;

    expect(trigger).not.toHaveBeenCalled();
    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({ occurrenceAt: created.at, status: "interrupted" });
    expect(row.state).toBe("completed");
  });
});
