import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { clone, makeArray, pick } from "cosmokit";
import { Universal } from "koishi";
import { Database, Driver, Eval, executeEval, executeQuery, executeSort, executeUpdate, Field, RuntimeError, Selection } from "minato";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { EventRecord } from "../../../core/src/messages.js";
import SchedulePlugin from "../src/index.js";
import { ScheduleStore } from "../src/store.js";

const SCOPE = { type: "shared", platform: "test", selfId: "bot-1", channelId: "room-1" } as const;

type Row = Record<string, unknown>;

type CommandStub = { subcommand(): CommandStub; option(): CommandStub; action(): CommandStub; dispose(): void };

type Fixture = { ctx: Context; plugin: SchedulePlugin; store: ScheduleStore; trigger: Mock<(event: EventRecord) => Promise<void>>; basePath: string };

/**
 * Minimal in-memory Minato driver.
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

/**
 * Creates a fixture that mocks `ctx.yesimbot` as a minimal facade with only
 * `trigger` and `registerChannelPlugin`, avoiding any dependency on the real
 * Core service, RuntimeManager, or ChannelRuntime.
 */
async function createFixture(): Promise<Fixture> {
  const basePath = await mkdtemp(join(tmpdir(), "yesimbot-schedule-int-"));
  const ctx = new Context();
  ctx.baseDir = basePath;
  const model = ctx.model as Database;
  await model.connect(MemoryDriver, {});

  vi.spyOn(ctx, "command").mockImplementation((() => {
    const command: CommandStub = { subcommand: () => command, option: () => command, action: () => command, dispose: () => undefined };
    return command;
  }) as never);
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);

  const trigger = vi.fn(async () => undefined) as Mock<(event: EventRecord) => Promise<void>>;
  const yesimbot = { trigger, registerChannelPlugin: vi.fn(() => () => undefined) };
  Object.assign(ctx, { yesimbot });

  const plugin = new SchedulePlugin(ctx as never);
  const store = new ScheduleStore(ctx.model);

  return { ctx, plugin, store, trigger, basePath };
}

function futureInstant(offsetMs = 3_600_000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Starts the real plugin under the fake clock, positioned at `instant`.
 */
async function startPluginAt(fixture: Fixture, instant: string): Promise<void> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(Date.parse(instant)));
  await fixture.plugin.stop();
  await fixture.plugin.start();
}

/**
 * Advances fake time while yielding one real event-loop turn until the
 * observable completion condition is true.
 */
async function settleUntil<T>(description: string, condition: () => T | false | Promise<T | false>, timeoutMs = 120_000, stepMs = 1_000): Promise<T> {
  for (let elapsedMs = 0; elapsedMs <= timeoutMs; elapsedMs += stepMs) {
    const result = await condition();
    if (result) return result;
    await vi.advanceTimersByTimeAsync(stepMs);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms of fake time`);
}

describe("Schedule proactive trigger integration", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fixture.plugin.stop();
    vi.restoreAllMocks();
    await rm(fixture.basePath, { recursive: true, force: true });
  });

  it("submits a due schedule.due event with the correct EventRecord shape", async () => {
    const dueIso = futureInstant();
    const created = await fixture.store.create(SCOPE, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: dueIso });

    await startPluginAt(fixture, dueIso);
    await settleUntil("trigger called", () => fixture.trigger.mock.calls.length === 1);

    expect(fixture.trigger).toHaveBeenCalledTimes(1);
    expect(fixture.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "schedule.due", platform: "test", selfId: "bot-1", channel: { id: "room-1", type: Universal.Channel.Type.TEXT } }),
    );
    const event = fixture.trigger.mock.calls[0][0] as EventRecord<"schedule.due">;
    expect(event).toMatchObject({
      text: 'Schedule "standup" is due.\nPrepare the daily standup.',
      schedule: { id: created.id, title: "standup", kind: "once", scheduledFor: dueIso },
    });
    expect(event.timestamp).toBe(Date.parse(dueIso));
  });

  it("marks schedule accepted when trigger resolves", async () => {
    const dueIso = futureInstant();
    await fixture.store.create(SCOPE, { title: "standup", prompt: "Ping.", kind: "once", at: dueIso });

    await startPluginAt(fixture, dueIso);
    await settleUntil("accepted", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "accepted";
    });

    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.nextRunAt).toBeNull();
    expect(row.lastResult).toMatchObject({ occurrenceAt: dueIso, status: "accepted" });
  });

  it("marks schedule failed when trigger rejects", async () => {
    const dueIso = futureInstant();
    fixture.trigger.mockRejectedValueOnce(new Error("No Bot is available for test:bot-1"));
    await fixture.store.create(SCOPE, { title: "standup", prompt: "Ping.", kind: "once", at: dueIso });

    await startPluginAt(fixture, dueIso);
    await settleUntil("failed", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "failed";
    });

    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.lastResult).toMatchObject({ occurrenceAt: dueIso, status: "failed", error: { name: "Error", message: "No Bot is available for test:bot-1" } });
  });

  it("submits multiple due schedules in the same scope", async () => {
    const dueIso = futureInstant();
    const first = await fixture.store.create(SCOPE, { title: "first", prompt: "Ping.", kind: "once", at: dueIso });
    const second = await fixture.store.create(SCOPE, { title: "second", prompt: "Pong.", kind: "once", at: dueIso });

    await startPluginAt(fixture, dueIso);
    await settleUntil("both triggered", () => fixture.trigger.mock.calls.length === 2);

    expect(fixture.trigger).toHaveBeenCalledTimes(2);
    const submitted = fixture.trigger.mock.calls.map(([event]) => (event as EventRecord<"schedule.due">).schedule?.id);
    expect(submitted).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("preserves rows and advances nextRunAt for cron schedules across a cycle", async () => {
    const created = await fixture.store.create(SCOPE, { title: "quarterly", prompt: "Ping.", kind: "cron", cron: "*/15 * * * *" });
    const firstDue = created.nextRunAt!;

    await startPluginAt(fixture, firstDue);
    await settleUntil("first accepted", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "accepted";
    });

    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("enabled");
    expect(row.nextRunAt).not.toBe(firstDue);
    expect(row.nextRunAt).not.toBeNull();
    expect(row.lastResult).toMatchObject({ status: "accepted" });
  });

  it("recovers a submitting occurrence as interrupted through plugin start", async () => {
    const dueIso = futureInstant();
    const created = await fixture.store.create(SCOPE, { title: "standup", prompt: "Prepare the daily standup.", kind: "once", at: dueIso });

    await startPluginAt(fixture, dueIso);
    const claimed = await fixture.store.claim(created.id, dueIso);
    expect(claimed?.lastResult).toMatchObject({ occurrenceAt: dueIso, status: "submitting" });
    await fixture.plugin.stop();

    vi.setSystemTime(new Date(Date.parse(dueIso) + 1_000));
    await fixture.plugin.start();
    await settleUntil("recovery", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "interrupted";
    });

    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.lastResult).toMatchObject({ occurrenceAt: dueIso, status: "interrupted" });
    expect(row.nextRunAt).toBeNull();
  });

  it("produces no trigger after plugin disposal and preserves rows", async () => {
    const created = await fixture.store.create(SCOPE, { title: "quarterly", prompt: "Ping.", kind: "cron", cron: "*/15 * * * *" });
    const firstDue = created.nextRunAt!;

    await startPluginAt(fixture, firstDue);
    await fixture.plugin.stop();

    await vi.advanceTimersByTimeAsync(0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fixture.trigger).not.toHaveBeenCalled();
    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("enabled");
    expect(row.nextRunAt).toBe(firstDue);
    expect(row.lastResult).toBeUndefined();
  });
});
