import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { createJsonlStorage, createMessageEntry, orderPlugins } from "@yesimbot/agent-runtime";
import type { AgentPlugin, AgentTool, ModelMessageContext } from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImageBudget } from "../src/config.js";

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

import { h } from "koishi";

import type { Config } from "../src/config.js";
import {
  createEvent,
  createMessage,
  isEvent,
  isMessage,
  type EventRecord,
  type MessageRecord,
} from "../src/messages.js";
import { ChannelRuntime } from "../src/runtime/index.js";
import type { ResourceSchemeOpenHandler } from "../src/runtime/read.js";

function runtimeConfig(basePath: string, reply: Partial<Config["reply"]> = {}): Config {
  return {
    basePath,
    chatModel: "test:model",
    visionModel: undefined,
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    resourceReadTimeoutMs: 30_000,
    reply: {
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      customInnerThought: false,
      ...reply,
    },
  };
}

function record(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: "message-1",
    elements: [h.text("hello")],
    ...overrides,
  };
}

function forcedEvent(): EventRecord<"delivery.failed"> {
  return {
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
}

function createRuntime(
  will: WillEngine,
  sendMessage = vi.fn(async () => ["sent-1"]),
  basePath = "/tmp/yesimbot-channel-runtime",
  reply?: Partial<Config["reply"]>,
  registrations: ReadonlyMap<string, { prompt: string; open: ResourceSchemeOpenHandler }> = new Map(),
  imageCapable = false,
  imageBudget: ImageBudget | null = null,
  visionModel: LanguageModel | undefined = undefined,
) {
  const ctx = new Context();
  const assets = { clear: vi.fn(async () => undefined), get: vi.fn(), put: vi.fn() };
  const artifacts = { clear: vi.fn(async () => undefined), forTool: vi.fn(), open: vi.fn() };
  const runtime = new ChannelRuntime(ctx, {
    config: runtimeConfig(basePath, reply),
    scope: { platform: "test", selfId: "bot-1", channelId: "room-1", type: "shared" },
    bot: { sendMessage } as never,
    will,
    assets: assets as never,
    artifacts: artifacts as never,
    registrations,
    model: {} as never,
    visionModel,
    imageCapable,
    imageBudget,
    agentPlugins: [],
    storage: createJsonlStorage("/tmp/yesimbot-channel-runtime/messages.jsonl"),
  });
  return { ctx, runtime, sendMessage, assets };
}

function streamFrom(events: readonly unknown[]): AsyncIterable<unknown> {
  return (async function* () {
    yield* events;
  })();
}

async function beginReply(runtime: ChannelRuntime) {
  const result = await runtime.handle(record());
  if (result.kind !== "run") throw new Error("Expected a running reply");
  return result;
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
    state.resolvedSystem = undefined;
  });

  it("exposes the Core sendMessage tool with a stable name and input schema", () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const tools = state.options?.tools as AgentTool[] | undefined;
    const send = tools?.find((tool) => tool.name === "sendMessage");
    expect(send).toBeDefined();
    const schema = (send?.inputSchema as { jsonSchema?: { properties?: Record<string, { description?: string }> } })
      .jsonSchema;
    expect(send?.name).toBe("sendMessage");
    expect(Object.keys(schema?.properties ?? {})).toEqual(["channelId", "content"]);
    expect(runtime).toBeDefined();
  });

  it("orders registered read schemes alphabetically after fixed built-in schemes", () => {
    const registrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>([
      ["zeta", { prompt: "Z prompt", open: async () => ({ bytes: new Uint8Array() }) }],
      ["alpha", { prompt: "A prompt", open: async () => ({ bytes: new Uint8Array() }) }],
    ]);
    createRuntime({ decide: async () => "wait" }, undefined, undefined, undefined, registrations);
    const tools = state.options?.tools as AgentTool[] | undefined;
    const read = tools?.find((tool) => tool.name === "read");
    const description = read?.description ?? "";
    expect(description.indexOf("- alpha://")).toBeLessThan(description.indexOf("- zeta://"));
    expect(description.indexOf("- artifact://")).toBeLessThan(description.indexOf("- alpha://"));
  });

  it("varies the read tool description with the model's image capability", () => {
    createRuntime({ decide: async () => "wait" });
    const withoutImages = (state.options?.tools as AgentTool[] | undefined)?.find((tool) => tool.name === "read");

    createRuntime({ decide: async () => "wait" }, undefined, undefined, undefined, undefined, true, {
      maxCount: 4,
      maxBytesPerImage: 5 * 1024 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
    });
    const withImages = (state.options?.tools as AgentTool[] | undefined)?.find((tool) => tool.name === "read");

    expect(withImages?.description).not.toBe(withoutImages?.description);
  });

  it("registers describe_image only when a vision model is available", () => {
    createRuntime({ decide: async () => "wait" });
    const withoutVision = (state.options?.tools as AgentTool[] | undefined)?.map((tool) => tool.name);

    createRuntime(
      { decide: async () => "wait" },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      null,
      {} as LanguageModel,
    );
    const withVision = (state.options?.tools as AgentTool[] | undefined)?.map((tool) => tool.name);

    expect(withoutVision).not.toContain("describe_image");
    expect(withVision).toContain("describe_image");
  });

  it("continues channel FIFO work after a rejected operation", async () => {
    const decide = vi
      .fn()
      .mockRejectedValueOnce(new Error("operation failed"))
      .mockResolvedValueOnce("wait" as const);
    const { runtime } = createRuntime({ decide });

    await expect(runtime.handle(record())).rejects.toThrow("operation failed");
    await expect(runtime.handle(record({ messageId: "message-2" }))).resolves.toMatchObject({
      kind: "wait",
    });
  });
  it("queues manual compaction behind the current turn", async () => {
    const entered = deferred();
    const release = deferred();
    const order: string[] = [];
    const will: WillEngine = {
      decide: async () => {
        order.push("turn");
        entered.resolve();
        await release.promise;
        return "wait";
      },
    };
    const { runtime } = createRuntime(will);
    const handling = runtime.handle(record());
    await entered.promise;
    const compacting = runtime.compact(async () => order.push("compact"));
    expect(order).toEqual(["turn"]);
    release.resolve();
    await Promise.all([handling, compacting]);
    expect(order).toEqual(["turn", "compact"]);
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
    const { runtime } = createRuntime({ decide: async () => "wait" as const }, sendMessage, basePath);

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
    const ctx = new Context();
    new ChannelRuntime(ctx, {
      config: runtimeConfig("/tmp/unused"),
      scope: { platform: "test", selfId: "bot-1", channelId: "room-1", type: "shared" },
      bot: { sendMessage: vi.fn() } as never,
      will: { decide: async () => "wait" },
      assets: { clear: vi.fn(), get: vi.fn(), put: vi.fn() } as never,
      artifacts: { clear: vi.fn(), forTool: vi.fn(), open: vi.fn() } as never,
      registrations: new Map(),
      model: {} as never,
      imageBudget: null,
      agentPlugins: [],
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
    ctx.on("yesimbot/message", () => order.push("event"));

    const result = await runtime.handle(record());

    expect(order).toEqual(["persist", "event", "will"]);
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
    const notice: EventRecord<"delivery.failed"> = {
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
    expect(order).toEqual(["persist", "event", "will"]);
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

  it("forces a committed event without Will", async () => {
    const decide = vi.fn(async () => "wait" as const);
    const { ctx, runtime } = createRuntime({ decide });
    const order: string[] = [];
    const observed: unknown[] = [];
    state.agent?.append.mockImplementation(async () => {
      order.push("append");
    });
    state.agent?.run.mockImplementation(() => {
      order.push("run");
      state.activeTurnId ??= "turn-1";
      return (async function* () {})();
    });
    ctx.on("yesimbot/event", (input) => {
      order.push("observe");
      observed.push(input);
    });
    ctx.on("yesimbot/will", () => order.push("will"));

    await expect(runtime.trigger(forcedEvent())).resolves.toMatchObject({
      kind: "run",
      turnId: "turn-1",
    });
    expect(decide).not.toHaveBeenCalled();
    expect(order).toEqual(["append", "observe", "run"]);
    const appended = state.agent?.append.mock.calls[0]?.[0] as
      | { readonly type: string; readonly data: unknown }
      | undefined;
    expect(appended).toMatchObject({
      type: "yesimbot.event",
      data: {
        eventType: "delivery.failed",
        platform: "test",
        selfId: "bot-1",
        channel: { id: "room-1", type: 0 },
        text: "Delivery failed",
        delivery: {
          turnId: "turn-1",
          messageId: "assistant-1",
          segmentIndex: 1,
          segmentTotal: 1,
          error: { name: "Error", message: "offline" },
        },
      },
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(appended);
    expect(state.agent?.run).toHaveBeenCalledOnce();
  });

  it("joins a forced event to the active turn", async () => {
    state.activeTurnId = "turn-active";
    const { runtime } = createRuntime({ decide: vi.fn(async () => "wait" as const) });

    await expect(runtime.trigger(forcedEvent())).resolves.toMatchObject({
      kind: "join",
      turnId: "turn-active",
    });
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
    const second = await runtime.handle(record({ messageId: "message-2" }));

    expect(first).toMatchObject({ kind: "run", turnId: "turn-1" });
    expect(second).toMatchObject({ kind: "join", turnId: "turn-1" });
    expect(state.agent?.run).toHaveBeenCalledOnce();
    expect(state.agent?.send).toHaveBeenCalledOnce();
    release.resolve();
    if (first.kind === "run") await Array.fromAsync(first.output);
  });

  it("exposes each complete assistant reply as one visible delivery plan", async () => {
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
        segments: [[h.text("first")]],
      },
      {
        turnId: "turn-1",
        messageId: "assistant-2",
        segments: [[h.text("second")]],
      },
    ]);
  });

  it("splits assistant output on message boundaries while removing only inner thought", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: "<inner_thought>private reasoning</inner_thought>first<message/>second",
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
        segments: [[h.text("first")], [h.text("second")]],
      },
    ]);
  });

  it("keeps blank-line prose in one fragment for native message delivery", async () => {
    state.stream = streamFrom([
      {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: { id: "assistant-1", role: "assistant", content: "first part\n\nsecond part" },
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
        segments: [[h.text("first part\n\nsecond part")]],
      },
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
    expect(sendMessage).toHaveBeenCalledWith("room-2", [h("text", { content: "hello" })]);
  });

  it("sends each message boundary as a separate active message", async () => {
    const sendMessage = vi.fn(async () => ["sent-1"]);
    const { runtime } = createRuntime({ decide: async () => "wait" }, sendMessage);
    const tool = (state.options?.tools as Array<{ name: string; execute: Function }>).find(
      (candidate) => candidate.name === "sendMessage",
    );

    await runtime.handle(record());

    await expect(
      tool?.execute({ channelId: "room-2", content: "<message>first</message><message>second</message>" }, {}),
    ).resolves.toEqual({
      ok: true,
      messageIds: ["sent-1", "sent-1"],
    });
    expect(sendMessage).toHaveBeenNthCalledWith(1, "room-2", [h("text", { content: "first" })]);
    expect(sendMessage).toHaveBeenNthCalledWith(2, "room-2", [h("text", { content: "second" })]);
  });

  it("always formats message events with their ID", async () => {
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const formatter = (state.options?.plugins as Array<{ name: string; toModelMessages: Function }>).find(
      (plugin) => plugin.name === "core.model-input",
    );

    await runtime.handle(record());
    const event = createMessage(record());
    const messages = await formatter?.toModelMessages(event, {
      history: [event],
      current: [],
    } satisfies ModelMessageContext);

    expect(messages[0].content).toContain('id="message-1"');
  });

  it("replays current split inputs without projecting unsupported JSONL payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-channel-replay-"));
    const path = join(directory, "messages.jsonl");
    const message = createMessage(record());
    const event = createEvent({
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
          role: "user",
          content: "unsupported",
        },
      }),
      JSON.stringify({
        id: "entry-missing",
        type: "message",
        timestamp: 4,
        data: {
          id: "missing",
          timestamp: 4,
          role: "assistant",
          content: "missing",
        },
      }),
    ].join("\n");
    await writeFile(path, `${fixture}\n`);
    const original = await readFile(path, "utf8");
    const storage = createJsonlStorage(path);
    const replay = await storage.read();
    const inputs = replay
      .filter((entry): entry is typeof entry & { readonly type: "message" } => entry.type === "message")
      .map((entry) => entry.data)
      .filter((entry) => isMessage(entry) || isEvent(entry));
    const unsupported = replay
      .filter((entry): entry is typeof entry & { readonly type: "message" } => entry.type === "message")
      .map((entry) => entry.data)
      .filter((entry) => !isMessage(entry) && !isEvent(entry));
    const { runtime } = createRuntime({ decide: async () => "wait" });
    const formatter = (state.options?.plugins as Array<{ name: string; toModelMessages: Function }>).find(
      (plugin) => plugin.name === "core.event-format",
    );
    const context = { history: inputs, current: [] } satisfies ModelMessageContext;

    const projected = await Promise.all(inputs.map((input) => formatter?.toModelMessages(input, context)));

    expect(runtime).toBeDefined();
    expect(inputs.map((input) => input.type)).toEqual(["yesimbot.message", "yesimbot.event"]);
    expect(projected).toHaveLength(2);
    expect(unsupported).toHaveLength(2);
    expect(await readFile(path, "utf8")).toBe(original);
    await rm(directory, { recursive: true, force: true });
  });

  it("preserves raw assistant output in JSONL history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yesimbot-raw-assistant-"));
    const path = join(directory, "messages.jsonl");
    const storage = createJsonlStorage(path);
    const assistant = {
      id: "assistant-1",
      timestamp: 1,
      role: "assistant" as const,
      content: "<inner_thought>private reasoning</inner_thought>first<message/>second",
    };

    await storage.append(createMessageEntry(assistant, { id: "entry-assistant", timestamp: 1 }));

    const [entry] = await storage.read();

    expect(entry).toMatchObject({ data: { content: assistant.content } });
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps Core event projection ahead of external pre plugins", () => {
    const externalPlugin: AgentPlugin = {
      name: "external.formatter",
      enforce: "pre",
      toModelMessages: async () => ({ role: "user", content: "external" }),
      onTurnFinish: async () => undefined,
    };
    const ctx = new Context();

    new ChannelRuntime(ctx, {
      config: runtimeConfig("/tmp/unused"),
      scope: { platform: "test", selfId: "bot-1", channelId: "room-1", type: "shared" },
      bot: { sendMessage: vi.fn() } as never,
      will: { decide: async () => "wait" },
      assets: { clear: vi.fn(), get: vi.fn(), put: vi.fn() } as never,
      artifacts: { clear: vi.fn(), forTool: vi.fn(), open: vi.fn() } as never,
      registrations: new Map(),
      model: {} as never,
      imageBudget: null,
      agentPlugins: [externalPlugin],
      storage: { append: vi.fn(), read: vi.fn(), clear: vi.fn() } as never,
    });

    const configured = state.options?.plugins;
    if (!Array.isArray(configured)) throw new Error("Agent plugins are unavailable");
    const ordered = orderPlugins(
      configured.filter(
        (plugin): plugin is AgentPlugin => typeof plugin === "object" && plugin !== null && "name" in plugin,
      ),
    );

    expect(ordered.map((plugin) => plugin.name)).toEqual(["core.model-input", "external.formatter"]);
    expect(ordered.find((plugin) => plugin.toModelMessages)?.name).toBe("core.model-input");
    expect(ordered.filter((plugin) => plugin.onTurnFinish).map((plugin) => plugin.name)).toEqual([
      "external.formatter",
    ]);
  });

  it("returns result-local delivery operations for a running reply", async () => {
    const onReply = vi.fn(async () => undefined);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });
    const result = await beginReply(runtime);

    expect(result).toMatchObject({
      kind: "run",
      delivery: {
        signal: expect.any(AbortSignal),
        onDelivered: expect.any(Function),
        fail: expect.any(Function),
      },
    });
    expect(result).not.toHaveProperty("delivery.release");
    await result.delivery.onDelivered();
    expect(onReply).toHaveBeenCalledOnce();
  });

  it("settles delivery.fail only after queued feedback is appended and observed, even across stop", async () => {
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    const will: WillEngine = {
      decide: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return "trigger" as const;
        if (calls === 2) {
          entered.resolve();
          await release.promise;
        }
        return "wait" as const;
      }),
    };
    const { ctx, runtime } = createRuntime(will);
    const observed: unknown[] = [];
    ctx.on("yesimbot/event", (input) => observed.push(input));

    const run = await beginReply(runtime);
    const blocking = runtime.handle(record({ messageId: "message-2" }));
    await entered.promise;

    let failed = false;
    const failing = run.delivery.fail(forcedEvent()).then(() => {
      failed = true;
    });
    await Promise.resolve();
    expect(failed).toBe(false);

    const stopping = runtime.stop();
    await Promise.resolve();
    expect(failed).toBe(false);

    release.resolve();
    await expect(failing).resolves.toBeUndefined();
    await Promise.all([blocking, stopping]);

    expect(failed).toBe(true);
    expect(state.agent?.append).toHaveBeenCalledTimes(3);
    const appended = state.agent?.append.mock.calls[2]?.[0] as
      | { readonly type: string; readonly data: unknown }
      | undefined;
    expect(appended).toMatchObject({
      type: "yesimbot.event",
      data: {
        eventType: "delivery.failed",
        platform: "test",
        selfId: "bot-1",
        channel: { id: "room-1", type: 0 },
        text: "Delivery failed",
        delivery: {
          turnId: "turn-1",
          messageId: "assistant-1",
          segmentIndex: 1,
          segmentTotal: 1,
          error: { name: "Error", message: "offline" },
        },
      },
    });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(appended);
  });

  it("does not notify Will for an aborted turn without acknowledgement", async () => {
    const onReply = vi.fn(async () => undefined);
    state.stream = streamFrom([{ type: "turn.aborted", id: "event-1", timestamp: 1, turnId: "turn-1" }]);
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });

    const result = await runtime.handle(record());
    if (result.kind !== "run") throw new Error("Expected a running reply");
    await expect(Array.fromAsync(result.output)).rejects.toThrow("Agent turn aborted");

    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps a successful acknowledgement after a later aborted turn", async () => {
    const onReply = vi.fn(async () => undefined);
    const continueAbort = deferred();
    state.stream = (async function* () {
      yield {
        type: "message.appended",
        id: "event-1",
        timestamp: 1,
        turnId: "turn-1",
        message: { id: "assistant-1", role: "assistant", content: "reply" },
      };
      await continueAbort.promise;
      yield { type: "turn.aborted", id: "event-2", timestamp: 2, turnId: "turn-1" };
    })();
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });

    const result = await runtime.handle(record());
    if (result.kind !== "run") throw new Error("Expected a running reply");
    const iterator = result.output[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ value: expect.any(Object) });
    await result.delivery.onDelivered();
    continueAbort.resolve();
    await expect(iterator.next()).rejects.toThrow("Agent turn aborted");

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("accepts acknowledgement when Will has no reply callback", async () => {
    const { runtime } = createRuntime({ decide: async () => "trigger" });
    const result = await beginReply(runtime);

    await expect(result.delivery.onDelivered()).resolves.toBeUndefined();
  });

  it("keeps a completed turn after a reply callback rejection", async () => {
    const onReply = vi.fn(async () => {
      throw new Error("reply charge failed");
    });
    const { runtime } = createRuntime({ decide: async () => "trigger", onReply });

    const result = await beginReply(runtime);
    await expect(result.delivery.onDelivered()).resolves.toBeUndefined();

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("returns active-send errors without creating delivery events", async () => {
    const { ctx, runtime } = createRuntime(
      { decide: async () => "wait" },
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const observed: unknown[] = [];
    ctx.on("yesimbot/event", (input) => observed.push(input));
    const tool = (state.options?.tools as Array<{ name: string; execute: Function }>).find(
      (candidate) => candidate.name === "sendMessage",
    );

    await runtime.handle(record());
    await expect(tool?.execute({ channelId: "room-2", content: "hello" }, {})).resolves.toEqual({
      ok: false,
      error: { name: "Error", message: "offline" },
    });
    expect(observed).toEqual([]);
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
    const { runtime } = createRuntime(will);
    state.agent?.stop.mockRejectedValueOnce(new Error("agent stop failed"));

    await runtime.handle(record());
    const stopping = runtime.stop();
    release.resolve();

    await expect(stopping).resolves.toBeUndefined();
    expect(state.agent?.stop).toHaveBeenCalledOnce();
    expect(will.stop).toHaveBeenCalledOnce();
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
