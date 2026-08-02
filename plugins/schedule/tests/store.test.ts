import { Context } from "cordis";
import { clone, makeArray, pick } from "cosmokit";
import type { ChannelScope } from "koishi-plugin-yesimbot";
import {
  Database,
  Driver,
  Eval,
  executeEval,
  executeQuery,
  executeSort,
  executeUpdate,
  Field,
  RuntimeError,
  Selection,
} from "minato";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleStore, registerScheduleModel } from "../src/store.js";
import type { ScheduleCreateInput, ScheduleUpdateInput } from "../src/types.js";

const sharedScope: ChannelScope = {
  type: "shared",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
};

const otherScope: ChannelScope = {
  type: "shared",
  platform: "test",
  selfId: "bot-1",
  channelId: "other-room",
};

const directScope: ChannelScope = {
  type: "direct",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
};

const FUTURE = "2030-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

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
    const tables = Object.fromEntries(
      Object.entries(this.store).map(([name, rows]) => [name, { name, count: rows.length, size: 0 }]),
    );
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
  // cordis types `ctx.model` through its own augmentation; the minato Database is what it exposes.
  const model = ctx.model as Database;
  await model.connect(MemoryDriver, {});
  return { ctx, model };
}

describe("ScheduleStore", () => {
  let store: ScheduleStore;

  beforeEach(async () => {
    const { model } = await createScheduleDatabase();
    registerScheduleModel(model);
    store = new ScheduleStore(model);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a valid once schedule with the raw scope fields", async () => {
    const schedule = await store.create(sharedScope, {
      title: "Standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    expect(schedule).toMatchObject({
      type: "shared",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      title: "Standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
      state: "enabled",
      nextRunAt: FUTURE,
    });
    expect(schedule.id).toBeDefined();
    expect(schedule.lastResult).toBeUndefined();
  });

  it("rejects a cron interval below the 15-minute limit", async () => {
    await expect(
      store.create(sharedScope, {
        title: "standup",
        prompt: "Prepare the daily standup.",
        kind: "cron",
        cron: "*/5 * * * *",
      }),
    ).rejects.toThrow("15 minutes");
  });

  it("computes the next Asia/Shanghai occurrence for a weekday cron", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    const schedule = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "cron",
      cron: "0 9 * * 1-5",
    });

    // 09:00 Asia/Shanghai on Friday 2026-07-31 is 01:00 UTC.
    expect(schedule.nextRunAt).toBe("2026-07-31T01:00:00.000Z");
  });

  it("interprets cron fields in fixed Asia/Shanghai time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    const schedule = await store.create(sharedScope, {
      title: "midnight",
      prompt: "Fire at local midnight.",
      kind: "cron",
      cron: "0 0 * * *",
    });

    // 00:00 Asia/Shanghai on 2026-08-01 is 16:00 UTC on 2026-07-31.
    expect(schedule.nextRunAt).toBe("2026-07-31T16:00:00.000Z");
  });

  it("rejects a past once instant", async () => {
    await expect(
      store.create(sharedScope, {
        title: "standup",
        prompt: "Prepare the daily standup.",
        kind: "once",
        at: PAST,
      }),
    ).rejects.toThrow(/in the future/);
  });

  it("rejects an input that provides both rule forms", async () => {
    // A runtime value with both at and cron is outside the create input union.
    const input = {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
      cron: "0 9 * * 1-5",
    } as unknown as ScheduleCreateInput;

    await expect(store.create(sharedScope, input)).rejects.toThrow(/exactly one/);
  });

  it("rejects an input that provides no rule", async () => {
    // A runtime value without a rule is outside the create input union.
    const input = {
      title: "standup",
      prompt: "Prepare the daily standup.",
    } as unknown as ScheduleCreateInput;

    await expect(store.create(sharedScope, input)).rejects.toThrow(/exactly one/);
  });

  it("rejects the twenty-first enabled schedule in one scope", async () => {
    for (let i = 0; i < 20; i++) {
      await store.create(sharedScope, {
        title: `schedule-${i}`,
        prompt: "Prepare the daily standup.",
        kind: "cron",
        cron: "0 9 * * 1-5",
      });
    }

    await expect(
      store.create(sharedScope, {
        title: "overflow",
        prompt: "Prepare the daily standup.",
        kind: "cron",
        cron: "0 9 * * 1-5",
      }),
    ).rejects.toThrow(/20 enabled schedules/);
  });

  it("enforces the 120-character title and 2000-character prompt limits", async () => {
    await expect(
      store.create(sharedScope, {
        title: "x".repeat(121),
        prompt: "Prepare the daily standup.",
        kind: "once",
        at: FUTURE,
      }),
    ).rejects.toThrow(/120 characters/);

    await expect(
      store.create(sharedScope, {
        title: "standup",
        prompt: "x".repeat(2001),
        kind: "once",
        at: FUTURE,
      }),
    ).rejects.toThrow(/2000 characters/);
  });

  it("lists only rows of the exact scope", async () => {
    await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    expect(await store.list(sharedScope)).toHaveLength(1);
    expect(await store.list(otherScope)).toEqual([]);
    // A direct scope over the same channel id is a different channel row.
    expect(await store.list(directScope)).toEqual([]);
  });

  it("initializes the audit timestamps on create", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    const schedule = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    expect(schedule.createdAt).toBe("2026-07-31T00:00:00.000Z");
    expect(schedule.updatedAt).toBe("2026-07-31T00:00:00.000Z");
  });

  it("advances updatedAt on each mutation and preserves createdAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const updated = await store.update(sharedScope, created.id, { title: "standup v2" });
    expect(updated.createdAt).toBe("2026-07-31T00:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-08-01T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    const paused = await store.pause(sharedScope, created.id);
    expect(paused.createdAt).toBe("2026-07-31T00:00:00.000Z");
    expect(paused.updatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("pauses an enabled schedule and clears its next run", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    const paused = await store.pause(sharedScope, created.id);
    expect(paused.state).toBe("paused");
    expect(paused.nextRunAt).toBeNull();
    expect(paused.prompt).toBe("Prepare the daily standup.");

    await expect(store.pause(sharedScope, created.id)).rejects.toThrow(/not enabled/);
  });

  it("resumes a paused schedule to its next future occurrence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "cron",
      cron: "0 9 * * 1-5",
    });
    await store.pause(sharedScope, created.id);

    const resumed = await store.resume(sharedScope, created.id);
    expect(resumed.state).toBe("enabled");
    expect(resumed.nextRunAt).toBe("2026-07-31T01:00:00.000Z");

    await expect(store.resume(sharedScope, created.id)).rejects.toThrow(/not paused/);
  });

  it("refuses to resume a once schedule with no future occurrence", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: "2030-01-01T00:00:00.000Z",
    });
    await store.pause(sharedScope, created.id);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));

    await expect(store.resume(sharedScope, created.id)).rejects.toThrow(/no future occurrence/);
  });

  it("rejects resume when twenty enabled schedules already occupy its exact scope", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
    const paused = await store.create(sharedScope, {
      title: "paused",
      prompt: "Wait.",
      kind: "cron",
      cron: "0 9 * * 1-5",
    });
    await store.pause(sharedScope, paused.id);
    for (let i = 0; i < 20; i++) {
      await store.create(sharedScope, {
        title: `replacement-${i}`,
        prompt: "Run.",
        kind: "cron",
        cron: "0 9 * * 1-5",
      });
    }

    await expect(store.resume(sharedScope, paused.id)).rejects.toThrow(/20 enabled schedules/);
    const row = (await store.list(sharedScope)).find((schedule) => schedule.id === paused.id)!;
    expect(row).toMatchObject({ id: paused.id, state: "paused", nextRunAt: null });
  });

  it("recovers an interrupted cron claim by advancing beyond elapsed next work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const created = await store.create(sharedScope, {
      title: "quarterly",
      prompt: "Ping.",
      kind: "cron",
      cron: "*/15 * * * *",
    });
    vi.setSystemTime(new Date("2026-08-01T00:15:00.000Z"));
    await store.claim(created.id, created.nextRunAt!);

    await store.recover(new Date("2026-08-01T00:40:00.000Z"));

    const [row] = await store.list(sharedScope);
    expect(row.lastResult).toMatchObject({
      occurrenceAt: "2026-08-01T00:15:00.000Z",
      status: "interrupted",
    });
    expect(row.nextRunAt).toBe("2026-08-01T00:45:00.000Z");
  });

  it("cancels a schedule and prevents later lifecycle operations", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    const cancelled = await store.cancel(sharedScope, created.id);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.nextRunAt).toBeNull();

    await expect(store.cancel(sharedScope, created.id)).rejects.toThrow(/cannot be cancelled/);
  });

  it("updates title, prompt, and the rule with validation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));

    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });

    const updated = await store.update(sharedScope, created.id, {
      title: "standup v2",
      kind: "cron",
      cron: "0 10 * * 1-5",
    });
    expect(updated.title).toBe("standup v2");
    expect(updated.kind).toBe("cron");
    expect(updated.cron).toBe("0 10 * * 1-5");
    // 10:00 Asia/Shanghai on Friday 2026-07-31 is 02:00 UTC.
    expect(updated.nextRunAt).toBe("2026-07-31T02:00:00.000Z");

    await expect(store.update(sharedScope, created.id, { kind: "once", at: PAST })).rejects.toThrow(/in the future/);
  });

  it("allows a title update on a due once schedule without re-validating its rule", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: "2030-01-01T00:00:00.000Z",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));

    const updated = await store.update(sharedScope, created.id, { title: "standup v2" });
    expect(updated.title).toBe("standup v2");
    expect(updated.nextRunAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("keeps a paused schedule unarmed across a rule update", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });
    await store.pause(sharedScope, created.id);

    const updated = await store.update(sharedScope, created.id, {
      kind: "cron",
      cron: "0 9 * * 1-5",
    });
    expect(updated.state).toBe("paused");
    expect(updated.nextRunAt).toBeNull();
    expect(updated.cron).toBe("0 9 * * 1-5");
  });

  it("rejects rule changes on a cancelled schedule", async () => {
    const created = await store.create(sharedScope, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: FUTURE,
    });
    await store.cancel(sharedScope, created.id);

    await expect(store.update(sharedScope, created.id, { kind: "cron", cron: "0 9 * * 1-5" })).rejects.toThrow(
      /cannot change its rule/,
    );
  });

  it("rejects operations on unknown schedule ids", async () => {
    const input: ScheduleUpdateInput = { title: "renamed" };
    await expect(store.update(sharedScope, "missing", input)).rejects.toThrow(/not found/);
    await expect(store.pause(sharedScope, "missing")).rejects.toThrow(/not found/);
    await expect(store.resume(sharedScope, "missing")).rejects.toThrow(/not found/);
    await expect(store.cancel(sharedScope, "missing")).rejects.toThrow(/not found/);
  });
});
