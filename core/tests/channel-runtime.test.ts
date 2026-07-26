import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import {
  createAgentChannel,
  createMessageEntry,
  createStateManager,
  orderPlugins,
} from "@yesimbot/agent-runtime";
import type {
  AgentPlugin,
  ModelMessageContext,
  TurnFinishContext,
  TurnResult,
} from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  agent: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
  options: undefined as Record<string, unknown> | undefined,
  activeTurnId: null as string | null,
  stream: undefined as AsyncIterable<unknown> | undefined,
  resolvedSystem: undefined as unknown,
  selectInputFiles: vi.fn(),
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

vi.mock("../src/media/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/media/index.js")>();
  return { ...actual, selectInputFiles: state.selectInputFiles };
});

import {
  createInput,
  isInput,
  type EventRecord,
  type Input,
  type MessageRecord,
} from "../src/event/index.js";
import { type MediaSelectionOptions, UnsupportedImageMimeError } from "../src/media/index.js";
import { ChannelRuntime, ChannelRuntimeDrainingError } from "../src/runtime/index.js";
import { createJsonlStorage } from "../src/runtime/storage.js";
import type { WillEngine } from "../src/will/index.js";

function record(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    schemaVersion: 1,
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: "message-1",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    text: "hello",
    ...overrides,
  };
}

function createRuntime(
  will: WillEngine,
  sendMessage = vi.fn(async () => ["sent-1"]),
  includeMessageId = false,
  basePath = "/tmp/yesimbot-channel-runtime",
) {
  const ctx = new Context();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
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
    provider: "test",
    imageInput: false,
    mediaPolicy: Object.freeze({
      enabled: true,
      maxCount: 4,
      maxBytesPerImage: 5 * 1024 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
      selection: "current-first" as const,
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

function coreWillReplyPlugin(): AgentPlugin {
  const plugins = state.options?.plugins;
  if (!Array.isArray(plugins)) throw new Error("Agent plugins are unavailable");
  const plugin = plugins.find(
    (candidate): candidate is AgentPlugin =>
      typeof candidate === "object" &&
      candidate !== null &&
      "name" in candidate &&
      candidate.name === "core.will-reply",
  );
  if (!plugin) throw new Error("Core Will reply plugin is unavailable");
  return plugin;
}

function turnResult(status: TurnResult["status"], messages: TurnResult["messages"]): TurnResult {
  return { turnId: "turn-1", status, messages };
}

function turnFinishContext(): TurnFinishContext {
  return {
    runtime: { id: "channel-test" },
    channel: createAgentChannel(),
    state: createStateManager({
      storage: createJsonlStorage("/tmp/yesimbot-turn-finish/messages.jsonl"),
    }),
    turnId: "turn-1",
  };
}

async function beginReply(runtime: ChannelRuntime): Promise<void> {
  const result = await runtime.handle(record());
  if (result.kind !== "run") throw new Error("Expected a running reply");
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
    state.selectInputFiles.mockReset();
    state.selectInputFiles.mockResolvedValue(new Map());
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
      provider: "test",
      imageInput: false,
      mediaPolicy: Object.freeze({
        enabled: true,
        maxCount: 4,
        maxBytesPerImage: 5 * 1024 * 1024,
        maxTotalBytes: 10 * 1024 * 1024,
        selection: "current-first" as const,
      }),
      agentPlugins: [],
      includeMessageId: false,
      storage: storage as never,
    });

    expect(state.options?.storage).toBe(storage);
  });

  it("persists ordinary messages before Input observation and Will evaluation", async () => {
    const order: string[] = [];
    const will: WillEngine = {
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

  it("persists non-message inputs before Input observation and Will evaluation", async () => {
    const order: string[] = [];
    const will: WillEngine = {
      decide: vi.fn(async () => {
        order.push("will");
        return "wait" as const;
      }),
    };
    const { ctx, runtime } = createRuntime(will);
    state.agent?.append.mockImplementation(async () => order.push("persist"));
    ctx.on("yesimbot/event", () => order.push("event"));
    ctx.on("yesimbot/will", () => order.push("will-observation"));
    const notice: EventRecord<"delivery.failed"> = {
      schemaVersion: 1,
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room-1", type: 0 },
      text: "Delivery failed",
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    };

    await expect(runtime.handle(notice)).resolves.toMatchObject({ kind: "wait" });
    expect(order).toEqual(["persist", "event", "will", "will-observation"]);
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
    const { logger, runtime } = createRuntime({ decide: async () => "trigger" });

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
    const { logger, runtime } = createRuntime({ decide: async () => "trigger" });

    const first = await runtime.handle(record());
    const second = await runtime.handle(record({ messageId: "message-2", text: "next" }));

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
      {
        turnId: "turn-1",
        messageId: "assistant-1",
        content: "first",
        segmentIndex: 1,
        segmentTotal: 1,
        sleepHintMs: 0,
        provider: "test",
        controlAdopted: false,
        segmentLengths: [5],
      },
      {
        turnId: "turn-1",
        messageId: "assistant-2",
        content: "second",
        segmentIndex: 1,
        segmentTotal: 1,
        sleepHintMs: 0,
        provider: "test",
        controlAdopted: false,
        segmentLengths: [6],
      },
    ]);
  });

  it("emits ordered visible OCL segments without control or inner-thought text", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          content:
            '<inner_thought>private plan <sep/></inner_thought> first <sleep ms="120"/><sep/> second',
        },
      },
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);
    const { runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).resolves.toEqual([
      {
        turnId: "turn-1",
        messageId: "assistant-1",
        content: "first",
        segmentIndex: 1,
        segmentTotal: 2,
        sleepHintMs: 120,
        provider: "test",
        controlAdopted: true,
        segmentLengths: [5, 6],
      },
      {
        turnId: "turn-1",
        messageId: "assistant-1",
        content: "second",
        segmentIndex: 2,
        segmentTotal: 2,
        sleepHintMs: 0,
        provider: "test",
        controlAdopted: true,
        segmentLengths: [5, 6],
      },
    ]);
  });

  it("treats an OCL skip as a successful turn with no output", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "visible text<skip/><inner_thought>decline</inner_thought>",
        },
      },
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);
    const { logger, runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).resolves.toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "reply.delivery_observed",
        provider: "test",
        segmentCount: 0,
        skipped: true,
        deliveryStatus: "skipped",
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("decline");
  });

  it("observes an empty no-segment degradation without creating output", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: '<inner_thought>private fallback</inner_thought> <sep/> <sleep ms="20"/>',
        },
      },
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);
    const { logger, runtime } = createRuntime({ decide: async () => "trigger" });

    const result = await runtime.handle(record());

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).resolves.toEqual([]);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "reply.delivery_observed",
        provider: "test",
        segmentCount: 1,
        segmentLengths: [],
        controlAdopted: true,
        skipped: false,
        degradationReason: "no_segments",
        deliveryStatus: "incomplete",
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("private fallback");
  });

  it("keeps a delivery lease active while a segmented reply output is consumed", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: { id: "assistant-1", role: "assistant", content: "first<sep/>second" },
      },
      { type: "turn.done", id: "event-2", timestamp: 2, turnId: "turn-1" },
    ]);
    const { runtime } = createRuntime({ decide: async () => "trigger" });
    const result = await runtime.handle(record());
    const release = runtime.acquireDeliveryLease();
    const stopping = runtime.drainAndStop();

    expect(result.kind).toBe("run");
    if (result.kind !== "run") return;
    await expect(Array.fromAsync(result.output)).resolves.toHaveLength(2);
    await Promise.resolve();
    expect(state.agent?.stop).not.toHaveBeenCalled();

    release();
    await stopping;

    expect(state.agent?.stop).toHaveBeenCalledOnce();
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
    const event = createInput(record());
    const messages = await formatter?.toModelMessages(event, {
      history: [event],
      current: [],
    } satisfies ModelMessageContext);

    expect(messages[0].content).toContain('id="message-1"');
  });

  it("replays current split inputs without projecting unsupported JSONL payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-channel-replay-"));
    const path = join(directory, "messages.jsonl");
    const message = createInput(record());
    const event = createInput({
      schemaVersion: 1,
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room-1", type: 0 },
      text: "Delivery failed",
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    });
    const fixture = [
      JSON.stringify(createMessageEntry(message, { id: "entry-message", timestamp: 1 })),
      JSON.stringify(createMessageEntry(event, { id: "entry-event", timestamp: 2 })),
      JSON.stringify({
        id: "entry-unsupported",
        type: "message",
        timestamp: 3,
        data: {
          id: "unsupported",
          timestamp: 3,
          role: "custom",
          type: "yesimbot.message",
          data: { schemaVersion: 2, text: "unsupported" },
        },
      }),
      JSON.stringify({
        id: "entry-missing",
        type: "message",
        timestamp: 4,
        data: {
          id: "missing",
          timestamp: 4,
          role: "custom",
          type: "yesimbot.event",
          data: { eventType: "delivery.failed", text: "missing" },
        },
      }),
    ].join("\n");
    await writeFile(path, `${fixture}\n`);
    const original = await readFile(path, "utf8");
    const storage = createJsonlStorage(path);
    const replay = await storage.read();
    const inputs = replay
      .filter(
        (entry): entry is typeof entry & { readonly type: "message" } => entry.type === "message",
      )
      .map((entry) => entry.data)
      .filter(isInput);
    const unsupported = replay
      .filter(
        (entry): entry is typeof entry & { readonly type: "message" } => entry.type === "message",
      )
      .map((entry) => entry.data)
      .filter((entry) => !isInput(entry));
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");
    const context = { history: inputs, current: [] } satisfies ModelMessageContext;

    const projected = await Promise.all(
      inputs.map((input) => formatter?.toModelMessages(input, context)),
    );

    expect(runtime).toBeDefined();
    expect(inputs.map((input) => input.type)).toEqual(["yesimbot.message", "yesimbot.event"]);
    expect(projected).toHaveLength(2);
    expect(unsupported).toHaveLength(2);
    expect(await readFile(path, "utf8")).toBe(original);
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves raw assistant control content in JSONL history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-raw-assistant-"));
    const path = join(directory, "messages.jsonl");
    const storage = createJsonlStorage(path);
    const assistant = {
      id: "assistant-1",
      timestamp: 1,
      role: "assistant" as const,
      content: "<inner_thought>private plan</inner_thought>visible<sep/>second<skip/>",
    };

    await storage.append(createMessageEntry(assistant, { id: "entry-assistant", timestamp: 1 }));

    const [entry] = await storage.read();

    expect(entry).toMatchObject({ data: { content: assistant.content } });
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps Core event projection and Will reply hooks ahead of external pre plugins", () => {
    const externalPlugin: AgentPlugin = {
      name: "external.formatter",
      enforce: "pre",
      toModelMessages: async () => ({ role: "user", content: "external" }),
      onTurnFinish: async () => undefined,
    };
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
      provider: "test",
      imageInput: false,
      mediaPolicy: Object.freeze({
        enabled: true,
        maxCount: 4,
        maxBytesPerImage: 5 * 1024 * 1024,
        maxTotalBytes: 10 * 1024 * 1024,
        selection: "current-first" as const,
      }),
      agentPlugins: [externalPlugin],
      includeMessageId: false,
      storage: { append: vi.fn(), read: vi.fn(), clear: vi.fn() } as never,
    });

    const configured = state.options?.plugins;
    if (!Array.isArray(configured)) throw new Error("Agent plugins are unavailable");
    const ordered = orderPlugins(
      configured.filter(
        (plugin): plugin is AgentPlugin =>
          typeof plugin === "object" && plugin !== null && "name" in plugin,
      ),
    );

    expect(ordered.map((plugin) => plugin.name)).toEqual([
      "core.event-format",
      "core.will-reply",
      "external.formatter",
    ]);
    expect(ordered.find((plugin) => plugin.toModelMessages)?.name).toBe("core.event-format");
    expect(ordered.filter((plugin) => plugin.onTurnFinish).map((plugin) => plugin.name)).toEqual([
      "core.will-reply",
      "external.formatter",
    ]);
  });

  it("does not notify Will when a done multi-segment reply has no delivery acknowledgement", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await plugin.onTurnFinish?.(
      turnResult("done", [
        { id: "assistant-1", timestamp: 1, role: "assistant", content: "first<sep/>second" },
      ]),
      turnFinishContext(),
    );

    expect(onReply).not.toHaveBeenCalled();
  });

  it("reconciles a delivery acknowledgement that arrives before a done turn finish", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await runtime.completeDelivery("turn-1");
    await plugin.onTurnFinish?.(
      turnResult("done", [
        { id: "assistant-1", timestamp: 1, role: "assistant", content: "reply" },
      ]),
      turnFinishContext(),
    );

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("notifies Will once when a done multi-segment reply receives one acknowledgement", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await plugin.onTurnFinish?.(
      turnResult("done", [
        { id: "assistant-1", timestamp: 1, role: "assistant", content: "first<sep/>second" },
      ]),
      turnFinishContext(),
    );
    await runtime.completeDelivery("turn-1");

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("treats repeated delivery acknowledgements as one logical reply completion", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await plugin.onTurnFinish?.(
      turnResult("done", [
        { id: "assistant-1", timestamp: 1, role: "assistant", content: "reply" },
      ]),
      turnFinishContext(),
    );
    await runtime.completeDelivery("turn-1");
    await runtime.completeDelivery("turn-1");

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("does not notify Will for empty, failed, aborted, or assistant-free turn results", async () => {
    const onReply = vi.fn(async () => undefined);
    createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();
    const emptyAssistant = {
      id: "assistant-empty",
      timestamp: 1,
      role: "assistant",
      content: "   ",
    } satisfies TurnResult["messages"][number];

    await plugin.onTurnFinish?.(turnResult("done", [emptyAssistant]), turnFinishContext());
    await plugin.onTurnFinish?.(
      turnResult("done", [{ ...emptyAssistant, content: [{ type: "text", text: " " }] }]),
      turnFinishContext(),
    );
    await plugin.onTurnFinish?.(
      turnResult("failed", [
        { id: "assistant-failed", timestamp: 2, role: "assistant", content: "reply" },
      ]),
      turnFinishContext(),
    );
    await plugin.onTurnFinish?.(
      turnResult("aborted", [
        { id: "assistant-aborted", timestamp: 3, role: "assistant", content: "reply" },
      ]),
      turnFinishContext(),
    );
    await plugin.onTurnFinish?.(
      turnResult("done", [{ id: "tool-1", timestamp: 1, role: "tool", content: [] }]),
      turnFinishContext(),
    );

    expect(onReply).not.toHaveBeenCalled();
  });

  it("discards a failed turn before a later delivery acknowledgement", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await plugin.onTurnFinish?.(
      turnResult("failed", [
        { id: "assistant-1", timestamp: 1, role: "assistant", content: "reply" },
      ]),
      turnFinishContext(),
    );
    await runtime.completeDelivery("turn-1");

    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not notify Will for a done OCL skip", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await plugin.onTurnFinish?.(
      turnResult("done", [
        {
          id: "assistant-1",
          timestamp: 1,
          role: "assistant",
          content: "visible<skip/><inner_thought>decline</inner_thought>",
        },
      ]),
      turnFinishContext(),
    );
    await runtime.completeDelivery("turn-1");

    expect(onReply).not.toHaveBeenCalled();
  });

  it("accepts a done renderable reply when Will has no reply callback", async () => {
    const { logger, runtime } = createRuntime({ decide: async () => "trigger" });
    const plugin = coreWillReplyPlugin();

    await beginReply(runtime);
    await expect(
      plugin.onTurnFinish?.(
        turnResult("done", [
          { id: "assistant-1", timestamp: 1, role: "assistant", content: "reply" },
        ]),
        turnFinishContext(),
      ),
    ).resolves.toBeUndefined();
    await expect(runtime.completeDelivery("turn-1")).resolves.toBeUndefined();

    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "will_reply_failed" }),
    );
  });

  it("reports reply callback rejection without changing a completed turn", async () => {
    const onReply = vi.fn(async () => {
      throw new Error("reply charge failed");
    });
    const { logger, runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const plugin = coreWillReplyPlugin();
    const result = turnResult("done", [
      { id: "assistant-1", timestamp: 1, role: "assistant", content: "reply" },
    ]);

    await beginReply(runtime);
    await expect(plugin.onTurnFinish?.(result, turnFinishContext())).resolves.toBeUndefined();
    await expect(runtime.completeDelivery("turn-1")).resolves.toBeUndefined();

    expect(onReply).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "will_reply_failed", cause: expect.any(Error) }),
    );
  });

  it("selects files once for multiple Event conversions in the same model context", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");
    const first = createInput(record({ messageId: "message-1", text: "first" }));
    const second = createInput(record({ messageId: "message-2", text: "second" }));
    const file = { type: "file" as const, data: new Uint8Array([1]), mediaType: "image/png" };
    const context = { history: [first, second], current: [] } as ModelMessageContext;
    state.selectInputFiles.mockResolvedValue(
      new Map([
        [first.id, [file]],
        [second.id, [file]],
      ]),
    );

    await runtime.handle(record());
    const [firstResult, secondResult] = await Promise.all([
      formatter?.toModelMessages(first, context),
      formatter?.toModelMessages(second, context),
    ]);

    expect(state.selectInputFiles).toHaveBeenCalledOnce();
    expect(firstResult[0].content).toEqual([
      { type: "text", text: '[time="1970/1/1 08:00" sender="User (user-1)"]\nfirst' },
      file,
    ]);
    expect(secondResult[0].content).toEqual([
      { type: "text", text: '[time="1970/1/1 08:00" sender="User (user-1)"]\nsecond' },
      file,
    ]);
  });

  it("keeps generated files call-scoped while preserving historical event projection", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");
    const historical = createInput(record({ messageId: "message-history", text: "history" }));
    const current = createInput(record({ messageId: "message-current", text: "current" }));
    const historyFile = {
      type: "file" as const,
      data: new Uint8Array([1]),
      mediaType: "image/png",
    };
    const currentFile = {
      type: "file" as const,
      data: new Uint8Array([2]),
      mediaType: "image/png",
    };
    const firstContext = { history: [historical], current: [current] } as ModelMessageContext;
    const laterContext = { history: [historical, current], current: [] } as ModelMessageContext;
    state.selectInputFiles.mockImplementation(async (context: ModelMessageContext) =>
      context.current.length === 0
        ? new Map([[historical.id, [historyFile]]])
        : new Map([[current.id, [currentFile]]]),
    );

    await runtime.handle(record());
    expect(state.options).not.toHaveProperty("session");
    const [firstHistorical, firstCurrent] = await Promise.all([
      formatter?.toModelMessages(historical, firstContext),
      formatter?.toModelMessages(current, firstContext),
    ]);
    const [laterHistorical, laterCurrent] = await Promise.all([
      formatter?.toModelMessages(historical, laterContext),
      formatter?.toModelMessages(current, laterContext),
    ]);

    expect(firstHistorical[0].content).toBe(
      '[time="1970/1/1 08:00" sender="User (user-1)"]\nhistory',
    );
    expect(laterHistorical[0].content).toEqual([
      { type: "text", text: '[time="1970/1/1 08:00" sender="User (user-1)"]\nhistory' },
      historyFile,
    ]);
    expect(firstCurrent[0].content).toEqual([
      { type: "text", text: '[time="1970/1/1 08:00" sender="User (user-1)"]\ncurrent' },
      currentFile,
    ]);
    expect(laterCurrent[0].content).toBe('[time="1970/1/1 08:00" sender="User (user-1)"]\ncurrent');
    expect(state.selectInputFiles).toHaveBeenCalledTimes(2);
  });

  it("degrades a fatal selection failure once per context and retries for a fresh context", async () => {
    const { logger } = createRuntime({ decide: async () => "wait" });
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");
    const event = createInput(record());
    const firstContext = { history: [event], current: [] } as ModelMessageContext;
    const secondContext = { history: [event], current: [] } as ModelMessageContext;
    state.selectInputFiles.mockRejectedValueOnce(new Error("selection failed"));
    state.selectInputFiles.mockResolvedValueOnce(new Map());

    const first = await formatter?.toModelMessages(event, firstContext);
    const second = await formatter?.toModelMessages(event, firstContext);
    await formatter?.toModelMessages(event, secondContext);

    expect(first[0].content).toBe('[time="1970/1/1 08:00" sender="User (user-1)"]\nhello');
    expect(second[0].content).toBe('[time="1970/1/1 08:00" sender="User (user-1)"]\nhello');
    expect(state.selectInputFiles).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "media_selection_failed" }),
    );
  });

  it("reports invalid MIME and local read failures as distinct text-only diagnostics", async () => {
    const { logger } = createRuntime({ decide: async () => "wait" });
    const formatter = (
      state.options?.plugins as Array<{ name: string; toModelMessages: Function }>
    ).find((plugin) => plugin.name === "core.event-format");
    const event = createInput(record());
    const context = { history: [event], current: [] } as ModelMessageContext;
    state.selectInputFiles.mockImplementation(
      async (_context: ModelMessageContext, options: MediaSelectionOptions) => {
        options.onAssetFailure?.("asset_invalid", new UnsupportedImageMimeError());
        options.onAssetFailure?.("asset_missing", new Error("missing"));
        return new Map();
      },
    );

    const messages = await formatter?.toModelMessages(event, context);

    expect(messages[0].content).toBe('[time="1970/1/1 08:00" sender="User (user-1)"]\nhello');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "asset_invalid_mime", assetId: "asset_invalid" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "asset_read_failed", assetId: "asset_missing" }),
    );
  });

  it("returns active-send errors without creating delivery events", async () => {
    const { ctx, runtime } = createRuntime(
      { decide: async () => "wait" },
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const observed: Input[] = [];
    ctx.on("yesimbot/event", (input) => observed.push(input));
    const tool = (state.options?.tools as Array<{ name: string; execute: Function }>).find(
      (candidate) => candidate.name === "sendMessage",
    );

    await runtime.handle(record());
    await expect(tool?.execute({ channelId: "room-2", content: "hello" }, {})).resolves.toEqual({
      ok: false,
      error: { name: "Error", message: "offline" },
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]?.type).toBe("yesimbot.message");
  });

  it("queues one shared stop task after committed channel work", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const will: WillEngine = {
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
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
      text: "Delivery failed",
      schemaVersion: 1,
      eventType: "delivery.failed",
    };

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
    const will: WillEngine = {
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

  it("passes the current active turn id as the complete WillEngine state", async () => {
    const states: WillEngine.State[] = [];
    const { runtime } = createRuntime({
      decide: async (_event, state) => {
        states.push(state);
        return "wait";
      },
    });

    await runtime.handle(record());
    state.activeTurnId = "turn-active";
    await runtime.handle(record({ messageId: "message-2" }));

    expect(states).toEqual([{ activeTurnId: null }, { activeTurnId: "turn-active" }]);
  });
});
