import { Context, h } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPlatformService } from "./platform-service-helper.js";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  activeTurnId: undefined as string | undefined,
  created: [] as Array<Record<string, unknown>>,
  appends: [] as string[],
  sends: [] as string[],
  runs: [] as string[],
  operations: [] as string[],
  appendError: undefined as Error | undefined,
  appendFailures: [] as Error[],
  runEvents: [] as Array<Record<string, unknown>>,
  streamGate: undefined as Promise<void> | undefined,
  onBusyRead: undefined as (() => void) | undefined,
  submissionOperations: [] as string[],
  teardownFailures: [] as Array<{ interrupt?: Error; stop?: Error }>,
  agentCount: 0,
  reset() {
    this.activeTurnId = undefined;
    this.created = [];
    this.appends = [];
    this.sends = [];
    this.runs = [];
    this.operations = [];
    this.appendError = undefined;
    this.appendFailures = [];
    this.runEvents = [{ type: "turn.done", turnId: "turn" }];
    this.streamGate = undefined;
    this.onBusyRead = undefined;
    this.submissionOperations = [];
    this.teardownFailures = [];
    this.agentCount = 0;
  },
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn((options) => {
      const agentIndex = state.agentCount++;
      const teardownFailure = () => state.teardownFailures[agentIndex];
      state.created.push(options as Record<string, unknown>);
      return {
        id: options.id,
        channel: { emit: vi.fn(), subscribe: vi.fn(() => () => undefined) },
        storage: {} as never,
        state: {} as never,
        init: vi.fn(async () => undefined),
        stop: vi.fn(async () => {
          state.operations.push(`stop:${agentIndex}`);
          const cause = teardownFailure()?.stop;
          if (cause) throw cause;
        }),
        append: vi.fn(async (message: { data: { messageId: string } }) => {
          const failure = state.appendFailures.shift() ?? state.appendError;
          if (failure) throw failure;
          state.appends.push(message.data.messageId);
        }),
        send: vi.fn((message: { data: { messageId: string } }) => {
          state.sends.push(message.data.messageId);
          state.submissionOperations.push("send");
          return state.activeTurnId!;
        }),
        run: vi.fn((message: { data: { messageId: string } }) => {
          state.runs.push(message.data.messageId);
          state.submissionOperations.push("run");
          state.activeTurnId = `turn-${message.data.messageId}`;
          const events = [...state.runEvents];
          const gate = state.streamGate;
          return {
            async *[Symbol.asyncIterator]() {
              for (const event of events) yield event;
              if (gate) await gate;
              state.activeTurnId = undefined;
            },
          };
        }),
        wait: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => {
          state.operations.push(`interrupt:${agentIndex}`);
          const cause = teardownFailure()?.interrupt;
          if (cause) throw cause;
        }),
        setTools: vi.fn(),
        getModel: vi.fn(),
        setModel: vi.fn(),
        clear: vi.fn(async () => undefined),
        getActiveTurnId: vi.fn(() => {
          const activeTurnId = state.activeTurnId ?? null;
          state.submissionOperations.push("busy.read");
          state.onBusyRead?.();
          return activeTurnId;
        }),
        isIdle: vi.fn(() => state.activeTurnId === undefined),
      };
    }),
  };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: vi.fn(async () => {
      state.operations.push("storage.clear");
    }),
  })),
}));

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>();
  return { ...actual, ensureChannelScopeRecord: vi.fn(async () => undefined) };
});

import type { Config } from "../src/config.js";
import type { Platform } from "../src/platform/types.js";
import { ChannelRuntime } from "../src/runtime/channel-runtime.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };

function message(overrides: Partial<Platform.Message> = {}): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room", channelType: "group" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements: [h.text("hello")],
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    platform: "raw",
    selfId: "raw-bot",
    channelId: "raw-room",
    userId: "raw-user",
    messageId: "raw-message",
    content: "raw content",
    ...overrides,
  } as never;
}

async function handle(
  platform: ReturnType<typeof createTestPlatformService>,
  runtime: ChannelRuntime,
  input: Platform.Message,
  raw = session(),
) {
  platform.collectIfNeeded(raw);
  await runtime.handle(input, raw);
}

function createRuntime() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/athena";
  (ctx as Context & { "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } } })[
    "yesimbot.model"
  ] = { resolveChatModel: () => ({ model: { modelId: "mock:model" } }) };
  const platform = createTestPlatformService({ ctx: ctx as never });
  const delivery = { reply: vi.fn(async () => ({ status: "sent" })) } as never;
  const logger = ctx.logger("test");
  return {
    delivery,
    logger,
    platform,
    runtime: new ChannelRuntime({
      ctx,
      config,
      logger,
      platform,
      delivery,
      getAgentPlugins: vi.fn(() => []),
    }),
  };
}

describe("ChannelRuntime submission", () => {
  beforeEach(() => state.reset());

  it("derives agent identity and context from the canonical message", async () => {
    const { platform, runtime } = createRuntime();

    await handle(
      platform,
      runtime,
      message({
        source: { platform: "canonical", selfId: "bot-2" },
        scope: { type: "channel", channelId: "room-2", channelType: "private" },
      }),
      session({ bot: { selfId: "raw-bot" } }),
    );

    expect(state.created).toHaveLength(1);
    expect(state.created[0]?.id).toMatch(/^ch_v1_/);
    expect(state.created[0]?.systemPrompt).toContain(
      "platform=canonical, selfId=bot-2, channelId=room-2, type=private",
    );
  });

  it("submits append, idle reply, and busy reply through the configured action", async () => {
    const { platform, runtime } = createRuntime();

    await handle(platform, runtime, message({ messageId: "append" }));
    await handle(
      platform,
      runtime,
      message({
        messageId: "run",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
    );
    state.activeTurnId = "turn-run";
    await handle(
      platform,
      runtime,
      message({
        messageId: "join",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
    );

    expect(state.appends).toEqual(["append"]);
    expect(state.runs).toEqual(["run"]);
    expect(state.sends).toEqual(["join"]);
  });

  it("serializes preparation in one channel while allowing another channel to prepare", async () => {
    const { platform, runtime } = createRuntime();
    const entered: string[] = [];
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    platform.register({
      id: "test",
      platform: "test",
      async prepare({ message: input }) {
        entered.push(input.messageId);
        if (input.messageId === "a") await firstReady;
        return input.elements;
      },
    });

    const firstSession = session({ platform: "test" });
    platform.collectIfNeeded(firstSession);
    const first = runtime.handle(message({ messageId: "a" }), firstSession);
    await vi.waitFor(() => expect(entered).toEqual(["a"]));
    const sameChannelSession = session({ platform: "test" });
    platform.collectIfNeeded(sameChannelSession);
    const sameChannel = runtime.handle(message({ messageId: "b" }), sameChannelSession);
    const otherChannelSession = session({ platform: "test" });
    platform.collectIfNeeded(otherChannelSession);
    const otherChannel = runtime.handle(
      message({
        messageId: "c",
        scope: { type: "channel", channelId: "other", channelType: "group" },
      }),
      otherChannelSession,
    );
    await vi.waitFor(() => expect(entered).toEqual(["a", "c"]));
    releaseFirst();
    await Promise.all([first, sameChannel, otherChannel]);

    expect(entered).toEqual(["a", "c", "b"]);
  });

  it("runs when a busy turn becomes idle during preparation", async () => {
    const { platform, runtime } = createRuntime();
    let releasePreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      platform.register({
        id: "test",
        platform: "test",
        async prepare({ message: input }) {
          if (input.messageId === "after-preparation") {
            resolve();
            await new Promise<void>((release) => {
              releasePreparation = release;
            });
          }
          return input.elements;
        },
      });
    });
    state.activeTurnId = "busy-turn";

    const processing = handle(
      platform,
      runtime,
      message({
        messageId: "after-preparation",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
      session({ platform: "test" }),
    );
    await preparationStarted;
    state.activeTurnId = undefined;
    releasePreparation();
    await processing;

    expect(state.runs).toEqual(["after-preparation"]);
    expect(state.sends).toEqual([]);
  });

  it("submits a busy reply before a queued microtask", async () => {
    const { platform, runtime } = createRuntime();
    state.activeTurnId = "busy-turn";
    state.submissionOperations = [];
    state.onBusyRead = () => {
      queueMicrotask(() => {
        state.submissionOperations.push("microtask");
        state.activeTurnId = undefined;
      });
    };

    await handle(
      platform,
      runtime,
      message({
        messageId: "atomic-join",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
    );

    expect(state.sends).toEqual(["atomic-join"]);
    expect(state.runs).toEqual([]);
    expect(state.submissionOperations).toEqual(["busy.read", "send", "microtask"]);
  });

  it("starts an idle reply before a queued microtask", async () => {
    const { platform, runtime } = createRuntime();
    state.submissionOperations = [];
    state.onBusyRead = () => {
      queueMicrotask(() => {
        state.submissionOperations.push("microtask");
      });
    };

    await handle(
      platform,
      runtime,
      message({
        messageId: "atomic-run",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
    );

    expect(state.sends).toEqual([]);
    expect(state.runs).toEqual(["atomic-run"]);
    expect(state.submissionOperations).toEqual(["busy.read", "run", "microtask"]);
  });

  it("continues the same channel FIFO after a rejected lifecycle item", async () => {
    const { platform, runtime } = createRuntime();
    state.appendFailures = [new Error("append failed")];

    await handle(platform, runtime, message({ messageId: "failed" }));
    await handle(platform, runtime, message({ messageId: "later" }));

    expect(state.appends).toEqual(["later"]);
  });

  it("queues reset between preparation and a later message, then creates a fresh agent", async () => {
    const { platform, runtime } = createRuntime();
    let releasePreparation!: () => void;
    const preparationStarted = new Promise<void>((resolve) => {
      platform.register({
        id: "test",
        platform: "test",
        async prepare({ message: input }) {
          if (input.messageId === "before-reset") {
            state.operations.push("prepare:before:start");
            resolve();
            await new Promise<void>((release) => {
              releasePreparation = release;
            });
            state.operations.push("prepare:before:end");
          }
          if (input.messageId === "after-reset") state.operations.push("prepare:after");
          return input.elements;
        },
      });
    });
    vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
      state.operations.push("assets.clear");
    });
    const scope = { platform: "test", selfId: "bot", channelId: "room" };

    const before = handle(
      platform,
      runtime,
      message({ messageId: "before-reset" }),
      session({ platform: "test" }),
    );
    await preparationStarted;
    const reset = runtime.reset(scope);
    const after = handle(
      platform,
      runtime,
      message({ messageId: "after-reset" }),
      session({ platform: "test" }),
    );
    releasePreparation();
    await Promise.all([before, reset, after]);

    expect(state.operations).toEqual([
      "prepare:before:start",
      "prepare:before:end",
      "interrupt:0",
      "stop:0",
      "storage.clear",
      "assets.clear",
      "prepare:after",
    ]);
    expect(state.created).toHaveLength(2);
  });

  it("ignores self messages without preparing or constructing an agent", async () => {
    const { platform, runtime } = createRuntime();
    const prepare = vi.spyOn(platform, "prepareMessage");

    await handle(platform, runtime, message({ sender: { id: "bot" } }));

    expect(prepare).not.toHaveBeenCalled();
    expect(state.created).toEqual([]);
    expect(state.appends).toEqual([]);
    expect(state.sends).toEqual([]);
    expect(state.runs).toEqual([]);
  });
});

describe("ChannelRuntime stream delivery", () => {
  beforeEach(() => state.reset());

  it("projects ordered non-empty assistant text once for a reply turn", async () => {
    const { platform, runtime, delivery } = createRuntime();
    state.runEvents = [
      { type: "message.appended", message: { role: "assistant", content: "first" } },
      { type: "message.appended", message: { role: "tool", content: "ignored" } },
      { type: "message.appended", message: { role: "assistant", content: "   " } },
      {
        type: "message.appended",
        message: { role: "assistant", content: [{ type: "text", text: "second" }] },
      },
      { type: "turn.done", turnId: "turn" },
    ];
    const raw = session({ platform: "test" });

    await handle(
      platform,
      runtime,
      message({ scope: { type: "channel", channelId: "direct", channelType: "private" } }),
      raw,
    );

    expect(delivery.reply).toHaveBeenCalledWith(raw, ["first", "second"]);
    expect(delivery.reply).toHaveBeenCalledTimes(1);
  });

  it("waits for its owned stream and delivery after releasing the FIFO for joins", async () => {
    const { platform, runtime, delivery } = createRuntime();
    let releaseStream!: () => void;
    state.streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    state.runEvents = [
      { type: "message.appended", message: { role: "assistant", content: "reply" } },
      { type: "turn.done", turnId: "turn" },
    ];
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    delivery.reply.mockImplementation(async () => {
      await deliveryGate;
      return { status: "sent" };
    });

    const first = handle(
      platform,
      runtime,
      message({ scope: { type: "channel", channelId: "direct", channelType: "private" } }),
    );
    await vi.waitFor(() => expect(state.runs).toEqual(["m1"]));
    await handle(
      platform,
      runtime,
      message({
        messageId: "joined",
        scope: { type: "channel", channelId: "direct", channelType: "private" },
      }),
    );
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    expect(firstSettled).toBe(false);
    releaseStream();

    await vi.waitFor(() => expect(delivery.reply).toHaveBeenCalledTimes(1));
    expect(firstSettled).toBe(false);
    releaseDelivery();
    await first;
    expect(state.runs).toEqual(["m1"]);
    expect(state.sends).toEqual(["joined"]);
  });

  it("delivers one generic error for reply failures but not append failures", async () => {
    const { platform, runtime, delivery } = createRuntime();
    state.runEvents = [{ type: "turn.failed", error: { message: "turn failed" } }];

    await handle(
      platform,
      runtime,
      message({ scope: { type: "channel", channelId: "direct", channelType: "private" } }),
    );
    expect(delivery.reply).toHaveBeenCalledTimes(1);

    state.appendError = new Error("append failed");
    await expect(
      handle(platform, runtime, message({ messageId: "append-failed" })),
    ).resolves.toBeUndefined();
    expect(delivery.reply).toHaveBeenCalledTimes(1);
  });
});

describe("ChannelRuntime lifecycle", () => {
  beforeEach(() => state.reset());

  it("resets cached and uncached channels in destructive ownership order", async () => {
    const { platform, runtime } = createRuntime();
    vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
      state.operations.push("assets.clear");
    });
    const scope = { platform: "test", selfId: "bot", channelId: "room" };

    await handle(platform, runtime, message(), session({ platform: "test" }));
    await runtime.reset(scope);
    await runtime.reset({ ...scope, channelId: "uncached" });

    expect(state.operations).toEqual([
      "interrupt:0",
      "stop:0",
      "storage.clear",
      "assets.clear",
      "storage.clear",
      "assets.clear",
    ]);
  });

  it("stops new work, waits owned streams, and preserves persisted data", async () => {
    const { platform, runtime } = createRuntime();
    const clearChannel = vi.spyOn(platform, "clearChannel");
    let release!: () => void;
    state.streamGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scope = { platform: "test", selfId: "bot", channelId: "direct" };

    const pendingHandle = handle(
      platform,
      runtime,
      message({ scope: { type: "channel", channelId: "direct", channelType: "private" } }),
      session({ platform: "test" }),
    );
    await vi.waitFor(() => expect(state.runs).toEqual(["m1"]));
    let settled = false;
    const stopping = runtime.stop().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([stopping, pendingHandle]);

    await expect(handle(platform, runtime, message())).rejects.toThrow(
      "Channel runtime is stopped",
    );
    await expect(runtime.reset(scope)).rejects.toThrow("Channel runtime is stopped");
    expect(state.operations).toEqual(["interrupt:0", "stop:0"]);
    expect(clearChannel).not.toHaveBeenCalled();
  });

  it("completes teardown after agent failures and waits owned streams", async () => {
    const { logger, platform, runtime } = createRuntime();
    const report = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    let releaseStream!: () => void;
    state.streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    state.teardownFailures = [
      { interrupt: new Error("first interrupt"), stop: new Error("first stop") },
    ];

    const pendingHandle = handle(
      platform,
      runtime,
      message({ scope: { type: "channel", channelId: "direct", channelType: "private" } }),
      session({ platform: "test" }),
    );
    await vi.waitFor(() => expect(state.runs).toEqual(["m1"]));
    await handle(
      platform,
      runtime,
      message({
        messageId: "second",
        scope: { type: "channel", channelId: "other", channelType: "group" },
      }),
      session({ platform: "test" }),
    );

    let stopped = false;
    const stopping = runtime.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    releaseStream();
    await Promise.all([pendingHandle, stopping]);

    expect(state.operations).toEqual(["interrupt:0", "stop:0", "interrupt:1", "stop:1"]);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "runtime.teardown_failed",
        key: expect.any(String),
        operation: expect.stringMatching(/interrupt|stop/),
      }),
    );
    await expect(runtime.handle(message(), session())).rejects.toThrow(
      "Channel runtime is stopped",
    );
  });
});
