import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { clone, makeArray, pick } from "cosmokit";
import { h, Universal } from "koishi";
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
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Config } from "../../../core/src/config.js";
import YesImBot from "../../../core/src/index.js";
import type { EventRecord } from "../../../core/src/messages.js";
import SchedulePlugin from "../src/index.js";
import { SCHEDULE_TABLE, ScheduleStore } from "../src/store.js";

const state = vi.hoisted(() => ({
  agent: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
  activeTurnId: null as string | null,
  stream: undefined as AsyncIterable<unknown> | undefined,
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn(() => {
      const agent = {
        init: vi.fn(async () => undefined),
        append: vi.fn(async () => undefined),
        send: vi.fn(() => "turn-joined"),
        run: vi.fn(() => {
          state.activeTurnId ??= "turn-1";
          return state.stream ?? (async function* () {})();
        }),
        getActiveTurnId: vi.fn(() => state.activeTurnId),
        wait: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
        storage: { read: vi.fn(async () => []) },
      };
      state.agent = agent;
      return agent;
    }),
  };
});

const SCOPE = {
  type: "shared",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
} as const;

type Row = Record<string, unknown>;

type CommandStub = {
  option(): CommandStub;
  action(): CommandStub;
  dispose(): void;
};

type Fixture = {
  ctx: Context;
  service: YesImBot;
  plugin: SchedulePlugin;
  store: ScheduleStore;
  trigger: Mock<(event: EventRecord) => Promise<void>>;
  sendMessage: Mock;
  resolveChatModel: Mock;
  basePath: string;
};

/**
 * Minimal in-memory Minato driver, modeled on the semantics of
 * `@minatojs/driver-memory`. It exercises the real minato query pipeline
 * (query parsing, sorting, field defaults) without adding a package
 * dependency. Kept inline (same class as `scheduler.test.ts`) so this suite
 * adds no cross-test seam.
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
      Object.entries(this.store).map(([name, rows]) => [
        name,
        { name, count: rows.length, size: 0 },
      ]),
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

  public async set(
    sel: Selection.Mutable,
    data: Record<string, unknown>,
  ): Promise<Driver.WriteResult> {
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

  public async upsert(
    sel: Selection.Mutable,
    data: Row[],
    keys: string[],
  ): Promise<Driver.WriteResult> {
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
 * Builds the real proactive-trigger stack the Schedule plugin consumes:
 * the real YesImBotService facade, the real RuntimeManager and
 * ChannelRuntime FIFO, the real ChannelStorage and JSONL ownership, the real
 * minato query pipeline, and the real Bot-matched delivery path. Only two
 * controlled seams are used, both modeled on the existing Core suites
 * (`core/tests/service.test.ts` assigns a bare model service; the
 * `channel-runtime.test.ts` suite drives `createAgent` through a mock):
 * - `yesimbot.model.resolveChatModel` returns a placeholder model and can be
 *   pointed at a rejection to prove the "model missing" boundary;
 * - `@yesimbot/agent-runtime.createAgent` is mocked so no real model call
 *   happens, while the real ChannelRuntime still appends, observes, runs,
 *   joins, and delivers through it.
 * The Schedule trigger itself is never faked: the plugin's scheduler calls the
 * real `ctx.yesimbot.trigger()` and the real service resolves Bot matching,
 * runtime admission, output ownership, and delivery failure feedback.
 * The channel runtime is created eagerly with real timers (see
 * `warmUpRuntime`) so the fake-clock window only drives already-admitted
 * runtime paths; real fs inside a fake-timer callback chain is not reliably
 * serviced by the event loop.
 */
async function createFixture(
  options: { withBot?: boolean; warmUp?: boolean } = {},
): Promise<Fixture> {
  const basePath = await mkdtemp(join(tmpdir(), "yesimbot-schedule-int-"));
  const ctx = new Context();
  ctx.baseDir = basePath;
  // @koishijs/core registers the minato Database itself; do not start the app
  // here, because an already-started app fires the plugin's `ready` hook
  // immediately with real timers. The tests drive the plugin lifecycle
  // directly through its public `start()`/`stop()` under the fake clock.
  const model = ctx.model as Database;
  await model.connect(MemoryDriver, {});

  vi.spyOn(ctx, "command").mockImplementation((() => {
    const command: CommandStub = {
      option: () => command,
      action: () => command,
      dispose: () => undefined,
    };
    return command;
  }) as never);
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);

  const sendMessage = vi.fn(async () => []);
  if (options.withBot !== false) {
    ctx.bots.push({ platform: "test", selfId: "bot-1", sendMessage } as never);
  }

  const config: Config = {
    basePath: "data/yesimbot",
    chatModel: "test:model",
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    will: {
      engine: "routing",
      direct: "trigger",
      mention: "trigger",
      group: "wait",
    },
    reply: { pacing: { charactersPerSecond: 1000, maxTotalDelayMs: 10_000 } },
  };
  const service = new YesImBot(ctx as never, config);
  Object.assign(ctx, { yesimbot: service });

  const resolveChatModel = vi.spyOn(service.model, "resolveChatModel").mockReturnValue({
    model: {},
    providerId: "test",
    entry: {},
  } as never);
  // Create the channel runtime with real timers before the fake-clock window:
  // real fs work inside a fake-timer callback chain is not reliably serviced
  // by the event loop, so the runtime must already exist when the fake clock
  // drives the due event. The model-rejection test skips the warm-up so its
  // due event still performs runtime creation (resolveChatModel throws before
  // any fs work).
  if (options.withBot !== false && options.warmUp !== false) {
    await warmUpRuntime(service);
  }
  const trigger = vi.spyOn(service, "trigger") as unknown as Mock<
    (event: EventRecord) => Promise<void>
  >;
  const plugin = new SchedulePlugin(ctx as never);
  const store = new ScheduleStore(ctx.model);

  return {
    ctx,
    service,
    plugin,
    store,
    trigger,
    sendMessage,
    resolveChatModel,
    basePath,
  };
}

function futureInstant(offsetMs = 3_600_000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function streamFrom(events: readonly unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    yield* events;
  })();
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/**
 * Starts the real plugin under the fake clock, positioned at `instant`.
 *
 * @koishijs/core auto-starts its Context, so the plugin's `ready` hook already
 * fired once with real timers at construction. This driver restarts the real
 * plugin lifecycle methods (`stop()` then `start()`) so recovery and the
 * earliest-due timer run entirely under the fake clock.
 */
async function startPluginAt(fixture: Fixture, instant: string): Promise<void> {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(new Date(Date.parse(instant)));
  await fixture.plugin.stop();
  await fixture.plugin.start();
}

/**
 * Advances fake time while yielding one real event-loop turn until the
 * observable completion condition is true. The real Core path still performs
 * filesystem work, which fake timers cannot advance; the deadline bounds a
 * broken path without guessing how many event-loop turns it needs.
 */
async function settleUntil<T>(
  description: string,
  condition: () => T | false | Promise<T | false>,
  timeoutMs = 120_000,
  stepMs = 1_000,
): Promise<T> {
  for (let elapsedMs = 0; elapsedMs <= timeoutMs; elapsedMs += stepMs) {
    const result = await condition();
    if (result) return result;
    await vi.advanceTimersByTimeAsync(stepMs);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms of fake time`);
}

function replyEvent(messageId: string, text: string): unknown {
  return {
    type: "message.appended",
    id: `event-${messageId}`,
    timestamp: 1,
    turnId: "turn-1",
    message: { id: messageId, role: "assistant", content: text },
  };
}

/** Narrowing guard for the inputs the mocked Agent append receives. */
function isEventAppend(
  input: unknown,
  eventType: string,
): input is { type: "yesimbot.event"; data: { eventType: string } } {
  if (typeof input !== "object" || input === null) return false;
  if (!("type" in input) || input.type !== "yesimbot.event") return false;
  if (!("data" in input) || typeof input.data !== "object" || input.data === null) return false;
  return "eventType" in input.data && input.data.eventType === eventType;
}

/**
 * Creates the channel runtime eagerly with real timers by triggering one
 * output-less warm-up event through the real service facade, then resets the
 * mocked Agent state so the test's own due event sees a fresh turn. The
 * warm-up run produces no assistant output, so no delivery is attempted.
 */
async function warmUpRuntime(service: YesImBotService): Promise<void> {
  state.stream = (async function* () {})();
  await service.trigger({
    eventType: "schedule.due",
    platform: "test",
    selfId: "bot-1",
    timestamp: Date.now(),
    channel: { id: "room-1", type: Universal.Channel.Type.TEXT },
    text: "warmup",
    schedule: {
      id: "warmup",
      title: "warmup",
      kind: "once",
      scheduledFor: new Date().toISOString(),
    },
  });
  state.activeTurnId = null;
  state.stream = undefined;
  state.agent?.append.mockClear();
  state.agent?.run.mockClear();
  state.agent?.send.mockClear();
}

describe("Schedule proactive trigger integration", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fixture.plugin.stop();
    await fixture.service.stop();
    await fixture.ctx.stop();
    vi.restoreAllMocks();
    state.agent = undefined;
    state.activeTurnId = null;
    state.stream = undefined;
    await rm(fixture.basePath, { recursive: true, force: true });
  });

  it("submits one due schedule.due event through the real Core trigger and delivers via the matching Bot only", async () => {
    const dueIso = futureInstant();
    const created = await fixture.store.create(SCOPE, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: dueIso,
    });
    state.stream = streamFrom([
      replyEvent("assistant-1", "reply"),
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);

    await startPluginAt(fixture, dueIso);
    await settleUntil("initial due-event delivery", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return fixture.sendMessage.mock.calls.length === 1 && row?.lastResult?.status === "accepted";
    });

    expect(fixture.trigger).toHaveBeenCalledTimes(1);
    expect(fixture.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "schedule.due",
        platform: "test",
        selfId: "bot-1",
        channel: { id: "room-1", type: Universal.Channel.Type.TEXT },
      }),
    );
    const event = fixture.trigger.mock.calls[0][0] as EventRecord<"schedule.due">;
    expect(event).toMatchObject({
      text: 'Schedule "standup" is due.\nPrepare the daily standup.',
      schedule: {
        id: created.id,
        title: "standup",
        kind: "once",
        scheduledFor: dueIso,
      },
    });
    expect(event.timestamp).toBe(Date.parse(dueIso));

    // The real ChannelRuntime appended the event before the Agent turn started.
    const append = state.agent?.append;
    const run = state.agent?.run;
    expect(append).toBeDefined();
    expect(run).toBeDefined();
    expect(append!.mock.calls[0]?.[0]).toMatchObject({
      type: "yesimbot.event",
      data: expect.objectContaining({
        eventType: "schedule.due",
        schedule: {
          id: created.id,
          title: "standup",
          kind: "once",
          scheduledFor: dueIso,
        },
      }),
    });
    expect(append!.mock.invocationCallOrder[0]).toBeLessThan(run!.mock.invocationCallOrder[0]);
    // No inbound user message was routed: every appended input is an event.
    for (const [input] of append!.mock.calls) {
      expect(input).toMatchObject({ type: "yesimbot.event" });
    }

    expect(run).toHaveBeenCalledTimes(1);
    expect(state.agent?.send).not.toHaveBeenCalled();
    // Only the matching Bot's delivery path sent the assistant output.
    expect(fixture.sendMessage).toHaveBeenCalledOnce();
    expect(fixture.sendMessage).toHaveBeenCalledWith("room-1", [h.text("reply")]);

    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.nextRunAt).toBeNull();
    expect(row.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "accepted",
    });
  });

  it("joins a busy runtime with one event and no second output owner", async () => {
    const dueIso = futureInstant();
    const first = await fixture.store.create(SCOPE, {
      title: "first",
      prompt: "Ping.",
      kind: "once",
      at: dueIso,
    });
    const second = await fixture.store.create(SCOPE, {
      title: "second",
      prompt: "Pong.",
      kind: "once",
      at: dueIso,
    });
    const release = deferred();
    state.stream = (async function* () {
      await release.promise;
      yield replyEvent("assistant-1", "joined reply");
      yield {
        type: "turn.done",
        id: "event-2",
        timestamp: 2,
        turnId: "turn-1",
      };
    })();

    await startPluginAt(fixture, dueIso);
    await settleUntil(
      "both due events to enter the runtime",
      () => fixture.trigger.mock.calls.length === 2,
    );

    expect(fixture.trigger).toHaveBeenCalledTimes(2);
    const submitted = fixture.trigger.mock.calls.map(([event]) => event.schedule?.id);
    expect(submitted).toEqual(expect.arrayContaining([first.id, second.id]));
    // The active turn keeps the only output consumer.
    expect(state.agent?.run).toHaveBeenCalledTimes(1);
    expect(state.agent?.send).toHaveBeenCalledWith(expect.any(Object), {
      ifBusy: "join",
    });
    expect(state.agent?.send).toHaveBeenCalledTimes(1);
    expect(fixture.sendMessage).not.toHaveBeenCalled();

    release.resolve();
    await settleUntil("joined turn delivery", async () => {
      const rows = await fixture.store.list(SCOPE);
      return (
        fixture.sendMessage.mock.calls.length === 1 &&
        rows.every((row) => row.lastResult?.status === "accepted")
      );
    });

    expect(fixture.sendMessage).toHaveBeenCalledOnce();
    const rows = await fixture.store.list(SCOPE);
    expect(rows.map((row) => row.lastResult?.status)).toEqual(["accepted", "accepted"]);
  });

  it("rejects a due event with no matching Bot as failed without retry", async () => {
    const dueIso = futureInstant();
    await fixture.store.create(
      {
        type: "shared",
        platform: "test",
        selfId: "ghost-bot",
        channelId: "room-9",
      },
      { title: "ghost", prompt: "Ping.", kind: "once", at: dueIso },
    );

    await startPluginAt(fixture, dueIso);
    await settleUntil("missing-Bot rejection", async () => {
      const [row] = await fixture.store.list({
        type: "shared",
        platform: "test",
        selfId: "ghost-bot",
        channelId: "room-9",
      });
      return row?.lastResult?.status === "failed";
    });

    expect(fixture.trigger).toHaveBeenCalledTimes(1);
    expect(fixture.sendMessage).not.toHaveBeenCalled();
    const [row] = await fixture.store.list({
      type: "shared",
      platform: "test",
      selfId: "ghost-bot",
      channelId: "room-9",
    });
    expect(row.state).toBe("completed");
    expect(row.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "failed",
      error: {
        name: "Error",
        message: "No Bot is available for test:ghost-bot",
      },
    });
  });

  it("rejects a due event when model resolution fails as failed without retry", async () => {
    const dueIso = futureInstant();
    // This test needs runtime creation to happen on the due event, so the
    // shared warmed-up fixture is torn down and rebuilt without a warm-up.
    await fixture.plugin.stop();
    await fixture.service.stop();
    await fixture.ctx.stop();
    await rm(fixture.basePath, { recursive: true, force: true });
    fixture = await createFixture({ warmUp: false });
    fixture.resolveChatModel.mockImplementation(() => {
      throw new Error("unknown model");
    });
    await fixture.store.create(SCOPE, {
      title: "model",
      prompt: "Ping.",
      kind: "once",
      at: dueIso,
    });

    await startPluginAt(fixture, dueIso);
    await settleUntil("model-resolution rejection", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "failed";
    });

    expect(fixture.trigger).toHaveBeenCalledTimes(1);
    expect(fixture.sendMessage).not.toHaveBeenCalled();
    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "failed",
      error: { name: "Error", message: "unknown model" },
    });
  });

  it("preserves Schedule rows and future occurrences across a Core reset", async () => {
    const created = await fixture.store.create(SCOPE, {
      title: "quarterly",
      prompt: "Ping.",
      kind: "cron",
      cron: "*/15 * * * *",
    });
    const firstDue = created.nextRunAt!;
    state.stream = streamFrom([
      replyEvent("assistant-1", "first"),
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);

    await startPluginAt(fixture, firstDue);
    await settleUntil("first scheduled delivery", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return fixture.sendMessage.mock.calls.length === 1 && row?.lastResult?.status === "accepted";
    });
    expect(fixture.sendMessage).toHaveBeenCalledOnce();
    expect(await fixture.store.list(SCOPE)).toHaveLength(1);
    const [rowBeforeReset] = await fixture.store.list(SCOPE);
    const secondDue = rowBeforeReset.nextRunAt!;
    expect(secondDue).not.toBe(firstDue);

    // Core reset stops the runtime and clears Core storage only; rows stay.
    await fixture.service.reset(SCOPE);
    expect(await fixture.store.list(SCOPE)).toHaveLength(1);

    // Re-create the runtime with real timers, then re-arm the scheduler at
    // the next occurrence under a fresh fake clock (the previous fake timer
    // died with useRealTimers).
    vi.useRealTimers();
    await warmUpRuntime(fixture.service);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date(Date.parse(secondDue)));
    await fixture.plugin.stop();
    await fixture.plugin.start();
    state.stream = streamFrom([
      replyEvent("assistant-2", "second"),
      { type: "turn.done", id: "event-4", timestamp: 4, turnId: "turn-1" },
    ]);
    await settleUntil("post-reset scheduled delivery", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return fixture.sendMessage.mock.calls.length === 2 && row?.lastResult?.status === "accepted";
    });

    expect(fixture.sendMessage).toHaveBeenCalledTimes(2);
    expect(fixture.sendMessage).toHaveBeenLastCalledWith("room-1", [h.text("second")]);
    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("enabled");
    expect(row.lastResult).toMatchObject({ status: "accepted" });
    expect(row.nextRunAt).not.toBe(firstDue);
  });

  it("recovers a submitting occurrence as interrupted through the real plugin start", async () => {
    const dueIso = futureInstant();
    const created = await fixture.store.create(SCOPE, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: dueIso,
    });

    await startPluginAt(fixture, dueIso);
    // The durable claim happened, then the process stopped before the result.
    const claimed = await fixture.store.claim(created.id, dueIso);
    expect(claimed?.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "submitting",
    });
    await fixture.plugin.stop();

    vi.setSystemTime(new Date(Date.parse(dueIso) + 1_000));
    await fixture.plugin.start();
    await settleUntil("submitting occurrence recovery", async () => {
      const [row] = await fixture.store.list(SCOPE);
      return row?.lastResult?.status === "interrupted";
    });

    expect(fixture.trigger).not.toHaveBeenCalled();
    const [row] = await fixture.store.list(SCOPE);
    expect(row.state).toBe("completed");
    expect(row.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "interrupted",
    });
    expect(row.nextRunAt).toBeNull();
  });

  it("produces no later trigger after plugin disposal and preserves rows", async () => {
    const created = await fixture.store.create(SCOPE, {
      title: "quarterly",
      prompt: "Ping.",
      kind: "cron",
      cron: "*/15 * * * *",
    });
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

  it("delegates a delivery failure to Core delivery.failed feedback without retry or schedule history", async () => {
    const dueIso = futureInstant();
    fixture.sendMessage.mockRejectedValueOnce(new Error("offline"));
    await fixture.store.create(SCOPE, {
      title: "standup",
      prompt: "Prepare the daily standup.",
      kind: "once",
      at: dueIso,
    });
    state.stream = streamFrom([
      replyEvent("assistant-1", "reply"),
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);

    await startPluginAt(fixture, dueIso);
    await settleUntil("Core delivery failure feedback", async () => {
      const appended = state.agent?.append.mock.calls.map(([input]) => input as unknown);
      const feedback = appended?.some((input) => isEventAppend(input, "delivery.failed")) ?? false;
      const [row] = await fixture.store.list(SCOPE);
      return feedback && row?.lastResult?.status === "accepted";
    });

    // The trigger itself was accepted; the delivery failure stayed Core-owned.
    expect(fixture.trigger).toHaveBeenCalledTimes(1);
    expect(fixture.sendMessage).toHaveBeenCalledOnce();
    const appended = state.agent?.append.mock.calls.map(([input]) => input as unknown);
    const feedback = appended?.find((input) => isEventAppend(input, "delivery.failed"));
    expect(feedback).toBeDefined();
    const dueAppendIndex = appended?.findIndex((input) => isEventAppend(input, "schedule.due"));
    const feedbackAppendIndex = appended?.findIndex((input) =>
      isEventAppend(input, "delivery.failed"),
    );
    const appendOrder = state.agent?.append.mock.invocationCallOrder;
    const runOrder = state.agent?.run.mock.invocationCallOrder;
    expect(dueAppendIndex).toBeGreaterThanOrEqual(0);
    expect(feedbackAppendIndex).toBeGreaterThanOrEqual(0);
    expect(appendOrder?.[dueAppendIndex!]).toBeLessThan(runOrder?.[0]);
    expect(fixture.trigger.mock.invocationCallOrder[0]).toBeLessThan(
      appendOrder?.[dueAppendIndex!],
    );
    expect(runOrder?.[0]).toBeLessThan(fixture.sendMessage.mock.invocationCallOrder[0]);
    expect(fixture.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      appendOrder?.[feedbackAppendIndex!],
    );
    expect(feedback && "data" in feedback ? feedback.data : undefined).toMatchObject({
      eventType: "delivery.failed",
      channel: { id: "room-1", type: 0 },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    });

    // No Schedule retry and no Schedule-owned history row appeared: the
    // plugin-owned table still holds exactly the one original schedule.
    const [row] = await fixture.store.list(SCOPE);
    expect(row.lastResult).toMatchObject({
      occurrenceAt: dueIso,
      status: "accepted",
    });
    expect(row.state).toBe("completed");
    const persisted = await fixture.ctx.model.get(SCHEDULE_TABLE, {});
    expect(persisted).toHaveLength(1);
  });
});
