import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  agent: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
  options: undefined as Record<string, unknown> | undefined,
  activeTurnId: null as string | null,
  stream: undefined as AsyncIterable<unknown> | undefined,
  resolvedSystem: undefined as unknown,
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn((options) => {
      state.options = options as Record<string, unknown>;
      const agent = {
        init: vi.fn(async () => {
          const input = options.systemPrompt;
          state.resolvedSystem =
            typeof input === "function"
              ? await input({ id: "channel-test", channel: {} as never, state: {} as never })
              : input;
        }),
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
import { ChannelRuntime, ChannelRuntimeDrainingError } from "../src/runtime/channel.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
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
  basePath = "/tmp/yesimbot-channel-runtime",
) {
  const ctx = new Context();
  const logger = { warn: vi.fn() };
  const assets = { clear: vi.fn(async () => undefined), readByAssetId: vi.fn() };
  const runtime = new ChannelRuntime({
    ctx,
    config: { basePath, chatModel: "test:model" },
    logger: logger as never,
    scope: { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false },
    bot: { sendMessage } as never,
    will,
    assets: assets as never,
    model: {} as never,
    imageInput: false,
    mediaPolicy: Object.freeze({
      enabled: true,
      maxImages: 4,
      maxImageBytes: 5 * 1024 * 1024,
      maxTotalImageBytes: 10 * 1024 * 1024,
      strategy: "current-first" as const,
    }),
    agentPlugins: [],
    includeMessageId,
    storage: createJsonlStorage("/tmp/yesimbot-channel-runtime/messages.jsonl"),
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
    state.resolvedSystem = undefined;
  });

  it("initializes its Agent once", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" as const });

    await runtime.init();
    await runtime.init();

    expect(state.agent?.init).toHaveBeenCalledOnce();
  });

  it("keeps prompt-file content frozen after initialization", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-channel-prompt-"));
    await writeFile(join(basePath, "AGENTS.md"), "first policy");
    const sendMessage = vi.fn(async () => ["sent-1"]);
    const { runtime } = createRuntime(
      { decide: async () => "wait" as const },
      sendMessage,
      false,
      basePath,
    );

    await runtime.init();
    await writeFile(join(basePath, "AGENTS.md"), "second policy");
    await runtime.init();

    expect(state.agent?.init).toHaveBeenCalledOnce();
    expect(JSON.stringify(state.resolvedSystem)).toContain("first policy");
    expect(JSON.stringify(state.resolvedSystem)).not.toContain("second policy");
    await rm(basePath, { recursive: true, force: true });
  });

  it("uses the prepared Agent storage", () => {
    const storage = { append: vi.fn(), read: vi.fn(), clear: vi.fn() };
    new ChannelRuntime({
      ctx: new Context(),
      config: { basePath: "/tmp/unused", chatModel: "test:model" },
      logger: { warn: vi.fn() } as never,
      scope: { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false },
      bot: { sendMessage: vi.fn() } as never,
      will: { decide: async () => "wait" },
      assets: { clear: vi.fn(), readByAssetId: vi.fn() } as never,
      model: {} as never,
      imageInput: false,
      mediaPolicy: Object.freeze({
        enabled: true,
        maxImages: 4,
        maxImageBytes: 5 * 1024 * 1024,
        maxTotalImageBytes: 10 * 1024 * 1024,
        strategy: "current-first" as const,
      }),
      agentPlugins: [],
      includeMessageId: false,
      storage: storage as never,
    });

    expect(state.options?.storage).toBe(storage);
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

  it("keeps the inline Core event formatter before external plugins", () => {
    const externalPlugin = { name: "external.formatter" };
    const ctx = new Context();

    new ChannelRuntime({
      ctx,
      config: { basePath: "/tmp/unused", chatModel: "test:model" },
      logger: { warn: vi.fn() } as never,
      scope: { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false },
      bot: { sendMessage: vi.fn() } as never,
      will: { decide: async () => "wait" },
      assets: { clear: vi.fn(), readByAssetId: vi.fn() } as never,
      model: {} as never,
      imageInput: false,
      mediaPolicy: Object.freeze({
        enabled: true,
        maxImages: 4,
        maxImageBytes: 5 * 1024 * 1024,
        maxTotalImageBytes: 10 * 1024 * 1024,
        strategy: "current-first" as const,
      }),
      agentPlugins: [externalPlugin],
      includeMessageId: false,
      storage: { append: vi.fn(), read: vi.fn(), clear: vi.fn() } as never,
    });

    expect((state.options?.plugins as Array<{ name: string }>).map((plugin) => plugin.name)).toEqual([
      "core.event-format",
      "external.formatter",
    ]);
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

  it("waits for delivery release before graceful stop", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const release = runtime.acquireDeliveryLease();
    const stopping = runtime.drainAndStop();

    await Promise.resolve();
    expect(state.agent?.stop).not.toHaveBeenCalled();
    expect(state.agent?.interrupt).not.toHaveBeenCalled();

    release();
    await stopping;
    expect(state.agent?.wait).toHaveBeenCalledOnce();
    expect(state.agent?.stop).toHaveBeenCalledOnce();
    expect(state.agent?.interrupt).not.toHaveBeenCalled();
  });

  it("keeps a delivery lease release idempotent", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const first = runtime.acquireDeliveryLease();
    first();
    first();
    const second = runtime.acquireDeliveryLease();
    const stopping = runtime.drainAndStop();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(state.agent?.stop).not.toHaveBeenCalled();

    second();
    await stopping;
    expect(state.agent?.stop).toHaveBeenCalledOnce();
  });

  it("waits for committed FIFO work before graceful stop", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const { runtime } = createRuntime({
      decide: async () => {
        order.push("will");
        entered.resolve();
        await release.promise;
        return "wait";
      },
    });
    state.agent?.wait.mockImplementation(async () => order.push("agent.wait"));
    state.agent?.stop.mockImplementation(async () => order.push("agent.stop"));
    const handling = runtime.handle(record());
    await entered.promise;
    const stopping = runtime.drainAndStop();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(state.agent?.wait).not.toHaveBeenCalled();

    release.resolve();
    order.push("release");
    await Promise.all([handling, stopping]);
    expect(order).toEqual(["will", "release", "agent.wait", "agent.stop"]);
  });

  it("accepts internal completion while rejecting new platform events during drain", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const failure = {
      type: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room-1", type: 0 },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
      content: "Delivery failed",
    } as EventRecord<"delivery.failed">;

    runtime.beginDrain();

    await expect(runtime.handle(record())).rejects.toBeInstanceOf(ChannelRuntimeDrainingError);
    await expect(runtime.handleInternal(failure)).resolves.toMatchObject({ kind: "wait" });
  });

  it("rejects external events with a dedicated error before persistence while draining", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    runtime.beginDrain();

    await expect(runtime.handle(record())).rejects.toBeInstanceOf(ChannelRuntimeDrainingError);
    expect(state.agent?.append).not.toHaveBeenCalled();
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

  it("attempts scoped asset clearing and clears in-memory state after storage clearing fails", async () => {
    const { assets, runtime } = createRuntime({ decide: async () => "wait" });
    state.agent?.clear.mockRejectedValueOnce(new Error("storage failed"));

    await expect(runtime.reset()).rejects.toThrow("storage failed");
    expect(assets.clear).toHaveBeenCalledOnce();
  });

  it("keeps only the most recent bounded ordered events visible to Will state", async () => {
    const recent: string[][] = [];
    const { runtime } = createRuntime({
      decide: async (_event, state) => {
        recent.push(state.recent.map((event) => event.data.message?.id ?? ""));
        return "wait";
      },
    });

    for (let index = 0; index < 33; index += 1) {
      await runtime.handle(record({ message: { id: `message-${index}`, content: "hello" } }));
    }

    expect(recent.at(-1)).toEqual(Array.from({ length: 32 }, (_, index) => `message-${index + 1}`));
  });
});
