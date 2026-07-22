import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  agent: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
  options: undefined as Record<string, unknown> | undefined,
  activeTurnId: null as string | null,
  stream: undefined as AsyncIterable<unknown> | undefined,
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn((options) => {
      state.options = options as Record<string, unknown>;
      const agent = {
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

import type { EventRecord } from "../src/event/index.js";
import { ChannelRuntime } from "../src/runtime/channel.js";
import type { Will } from "../src/will/index.js";

function record(overrides: Partial<EventRecord<"message">> = {}): EventRecord<"message"> {
  return {
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    message: { id: "message-1", content: "hello" },
    content: "hello",
    ...overrides,
  } as EventRecord<"message">;
}

function createRuntime(
  will: Will,
  sendMessage = vi.fn(async () => ["sent-1"]),
  includeMessageId = false,
) {
  const ctx = new Context();
  const logger = { warn: vi.fn() };
  const assets = { clear: vi.fn(async () => undefined), readByAssetId: vi.fn() };
  const runtime = new ChannelRuntime({
    ctx,
    config: { basePath: "/tmp/yesimbot-channel-runtime", chatModel: "test:model" },
    logger: logger as never,
    scope: { platform: "test", selfId: "bot-1", channelId: "room-1" },
    bot: { sendMessage } as never,
    will,
    assets: assets as never,
    model: {} as never,
    agentPlugins: [],
    includeMessageId,
  });
  return { ctx, logger, runtime, sendMessage, assets };
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

describe("ChannelRuntime", () => {
  beforeEach(() => {
    state.agent = undefined;
    state.options = undefined;
    state.activeTurnId = null;
    state.stream = undefined;
  });

  it("persists before event observation and Will evaluation", async () => {
    const order: string[] = [];
    const will: Will = {
      decide: vi.fn(async () => {
        order.push("will");
        return "wait" as const;
      }),
    };
    const { ctx, runtime } = createRuntime(will);
    state.agent?.append.mockImplementation(async () => order.push("persist"));
    ctx.on("yesimbot/event", () => order.push("event"));
    ctx.on("yesimbot/will", () => order.push("will-observation"));

    const result = await runtime.handle(record());

    expect(order).toEqual(["persist", "event", "will", "will-observation"]);
    expect(result.kind).toBe("wait");
  });

  it("does not run or join when Will waits", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("wait");
    expect(state.agent?.run).not.toHaveBeenCalled();
    expect(state.agent?.send).not.toHaveBeenCalled();
  });

  it("joins a committed trigger to the active turn without creating output", async () => {
    state.activeTurnId = "turn-active";
    const { runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result).toMatchObject({ kind: "join", turnId: "turn-active" });
    expect(state.agent?.send).toHaveBeenCalledWith(expect.any(Object), { ifBusy: "join" });
    expect(state.agent?.run).not.toHaveBeenCalled();
  });

  it("keeps one stream owner when a second trigger joins an in-flight run", async () => {
    const release = deferred();
    state.stream = (async function* () {
      await release.promise;
    })();
    const { runtime } = createRuntime({ decide: async () => "trigger" });

    const first = await runtime.handle(record());
    const second = await runtime.handle(record({ message: { id: "message-2", content: "next" } }));

    expect(first).toMatchObject({ kind: "run", turnId: "turn-1" });
    expect(second).toMatchObject({ kind: "join", turnId: "turn-1" });
    expect(state.agent?.run).toHaveBeenCalledOnce();
    expect(state.agent?.send).toHaveBeenCalledOnce();
    release.resolve();
    if (first.kind === "run") await Array.fromAsync(first.output);
  });

  it("yields complete assistant messages in order and filters internal events", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: { id: "assistant-1", role: "assistant", content: "first" },
      },
      { type: "turn.delta", id: "event-2", timestamp: 2, turnId: "turn-1", delta: "ignored" },
      {
        type: "message.appended",
        id: "event-3",
        timestamp: 3,
        turnId: "turn-1",
        message: { id: "assistant-2", role: "assistant", content: "second" },
      },
      { type: "turn.done", id: "event-4", timestamp: 4, turnId: "turn-1" },
    ]);
    const { runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).resolves.toEqual([
      { turnId: "turn-1", messageId: "assistant-1", content: "first" },
      { turnId: "turn-1", messageId: "assistant-2", content: "second" },
    ]);
  });

  it("terminates output when the Agent turn fails", async () => {
    state.stream = streamFrom([
      {
        type: "turn.failed",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        error: { name: "Error", message: "model failed" },
      },
    ]);
    const { runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).rejects.toThrow("model failed");
  });

  it("normalizes current-bot active sends", async () => {
    const { runtime, sendMessage } = createRuntime({ decide: async () => "wait" });
    const tool = (state.options?.tools as Array<{ name: string; execute: Function }>).find(
      (candidate) => candidate.name === "sendMessage",
    );

    await runtime.handle(record());

    await expect(tool?.execute({ channelId: "room-2", content: "hello" }, {})).resolves.toEqual({
      ok: true,
      messageIds: ["sent-1"],
    });
    expect(sendMessage).toHaveBeenCalledWith("room-2", "hello");
  });

  it("uses the explicit factory capability when formatting a message event", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" }, undefined, true);
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");

    await runtime.handle(record());
    const messages = await formatter?.toModelMessages({
      id: "event-1",
      timestamp: 1,
      role: "custom",
      type: "yesimbot.event",
      data: record(),
    });

    expect(messages[0].content).toContain('id="message-1"');
  });

  it("returns active-send errors without creating delivery events", async () => {
    const { ctx, runtime } = createRuntime(
      { decide: async () => "wait" },
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const observed: EventRecord[] = [];
    ctx.on("yesimbot/event", (event) => observed.push(event.data));
    const tool = (state.options?.tools as Array<{ name: string; execute: Function }>).find(
      (candidate) => candidate.name === "sendMessage",
    );

    await runtime.handle(record());
    await expect(tool?.execute({ channelId: "room-2", content: "hello" }, {})).resolves.toEqual({
      ok: false,
      error: { name: "Error", message: "offline" },
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]?.type).toBe("message");
  });

  it("queues one shared stop task after committed channel work", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const will: Will = {
      decide: async () => {
        order.push("will");
        entered.resolve();
        await release.promise;
        return "wait";
      },
      stop: async () => {
        order.push("will.stop");
      },
    };
    const { runtime } = createRuntime(will);
    state.agent?.interrupt.mockImplementation(async () => order.push("interrupt"));
    state.agent?.stop.mockImplementation(async () => order.push("agent.stop"));

    const handling = runtime.handle(record());
    await entered.promise;
    const first = runtime.stop();
    const second = runtime.stop();

    expect(second).toBe(first);
    expect(order).toEqual(["will"]);
    await expect(runtime.handle(record())).rejects.toThrow("Channel runtime is stopped");
    release.resolve();
    await Promise.all([handling, first, second]);
    expect(order).toEqual(["will", "interrupt", "agent.stop", "will.stop"]);
  });

  it("isolates Agent and Will stop failures while waiting for an active stream", async () => {
    const release = deferred();
    state.stream = (async function* () {
      await release.promise;
    })();
    const will: Will = {
      decide: async () => "trigger",
      stop: vi.fn(async () => {
        throw new Error("will stop failed");
      }),
    };
    const { logger, runtime } = createRuntime(will);
    state.agent?.stop.mockRejectedValueOnce(new Error("agent stop failed"));

    await runtime.handle(record());
    const stopping = runtime.stop();
    release.resolve();

    await expect(stopping).resolves.toBeUndefined();
    expect(state.agent?.stop).toHaveBeenCalledOnce();
    expect(will.stop).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("resets in teardown order before clearing persisted channel state", async () => {
    const order: string[] = [];
    const will: Will = {
      decide: async () => "wait",
      stop: async () => order.push("will.stop"),
    };
    const { runtime, assets } = createRuntime(will);
    state.agent?.interrupt.mockImplementation(async () => order.push("interrupt"));
    state.agent?.stop.mockImplementation(async () => order.push("agent.stop"));
    state.agent?.clear.mockImplementation(async () => order.push("storage.clear"));
    assets.clear.mockImplementation(async () => order.push("assets.clear"));

    await runtime.reset();

    expect(order).toEqual([
      "interrupt",
      "agent.stop",
      "will.stop",
      "storage.clear",
      "assets.clear",
    ]);
  });

  it("keeps every recent event visible to Will state", async () => {
    const lengths: number[] = [];
    const { runtime } = createRuntime({
      decide: async (_event, state) => {
        lengths.push(state.recent.length);
        return "wait";
      },
    });

    for (let index = 0; index < 33; index += 1) {
      await runtime.handle(record({ message: { id: `message-${index}`, content: "hello" } }));
    }

    expect(lengths.at(-1)).toBe(33);
  });
});
