import { Context } from "@koishijs/core";
import { createEntry, createMemoryStorage } from "@yesimbot/agent-runtime";
import type { AgentEntry, AgentStorage } from "@yesimbot/agent-runtime";
import type * as AgentRuntime from "@yesimbot/agent-runtime";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  activeTurnId: null as string | null,
  idle: true,
  stream: undefined as (() => AsyncIterable<unknown>) | undefined,
}));

const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof Ai>()),
  generateText: mockGenerateText,
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof AgentRuntime>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      init: vi.fn(async () => undefined),
      append: vi.fn(async () => undefined),
      send: vi.fn(() => "turn-1"),
      run: vi.fn(() => {
        state.activeTurnId ??= "turn-1";
        return (
          state.stream?.() ??
          (async function* () {
            state.activeTurnId = null;
          })()
        );
      }),
      getActiveTurnId: vi.fn(() => state.activeTurnId),
      isIdle: vi.fn(() => state.idle),
      wait: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    })),
  };
});

import { h } from "koishi";

import type { Config } from "../src/config.js";
import type { MessageRecord } from "../src/messages.js";
import { ChannelRuntime } from "../src/runtime/channel.js";
import { createCompactPlugin } from "../src/runtime/compact/index.js";

function config(): Config {
  return {
    basePath: "/tmp/yesimbot-idle-timer",
    chatModel: "test:model",
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
    reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, customInnerThought: false },
  };
}

function record(messageId = "message-1"): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    timestamp: Date.now(),
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    messageId,
    elements: [h.text("hello")],
  };
}

function messages(count: number, timestamp = Date.now()): AgentEntry[] {
  return Array.from({ length: count }, (_, index) =>
    createEntry(
      "message",
      {
        id: `message-${index}`,
        role: "custom",
        data: { user: { id: `user-${index}` }, elements: [{ type: "text", attrs: { content: `message ${index}` } }] },
        timestamp,
      },
      { id: `entry-${index}`, timestamp },
    ),
  );
}

function createRuntime(options: {
  compact?: () => Promise<void>;
  idleTimeout?: number;
  storage?: AgentStorage<AgentEntry>;
}) {
  return new ChannelRuntime(new Context(), {
    config: config(),
    scope: { type: "shared", platform: "test", selfId: "bot-1", channelId: "room-1" },
    bot: { selfId: "bot-1", sendMessage: vi.fn(async () => []) } as never,
    will: { decide: async () => "trigger" },
    assets: { clear: vi.fn(), get: vi.fn(), put: vi.fn() } as never,
    artifacts: { clear: vi.fn(), forTool: vi.fn(), open: vi.fn() } as never,
    registrations: new Map(),
    model: {} as never,
    imageBudget: null,
    imageCapable: false,
    agentPlugins: [],
    storage: options.storage ?? createMemoryStorage(),
    idleTimeout: options.idleTimeout ?? 1_000,
    compact: options.compact,
  } as never);
}

async function finishTurn(runtime: ChannelRuntime): Promise<void> {
  state.stream = async function* () {
    state.activeTurnId = null;
  };
  const result = await runtime.handle(record());
  if (result.kind !== "run") throw new Error("Expected a running turn");
  await Array.fromAsync(result.output);
  state.stream = undefined;
}

describe("ChannelRuntime idle timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.activeTurnId = null;
    state.idle = true;
    state.stream = undefined;
    mockGenerateText.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the injected compaction after a completed turn is idle for the timeout", async () => {
    const compact = vi.fn(async () => undefined);
    const runtime = createRuntime({ compact });

    await finishTurn(runtime);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(compact).toHaveBeenCalledOnce();
  });

  it("restarts the idle timeout when a new record commits", async () => {
    const compact = vi.fn(async () => undefined);
    const runtime = createRuntime({ compact });

    await finishTurn(runtime);
    await vi.advanceTimersByTimeAsync(500);
    await runtime.handle(record("message-2"));
    await vi.advanceTimersByTimeAsync(500);
    expect(compact).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(compact).toHaveBeenCalledOnce();
  });

  it("skips expiry while the agent has an active turn", async () => {
    const compact = vi.fn(async () => undefined);
    const runtime = createRuntime({ compact });

    await finishTurn(runtime);
    state.activeTurnId = "active-turn";
    state.idle = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(compact).not.toHaveBeenCalled();

    state.activeTurnId = null;
    state.idle = true;
    await finishTurn(runtime);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(compact).toHaveBeenCalledOnce();
  });

  it("leaves sub-minimum conversations uncompressed at idle expiry", async () => {
    let compact: (() => Promise<void>) | undefined;
    let idleCompactions = 0;
    const storage = createMemoryStorage(messages(5));
    const plugin = createCompactPlugin({
      model: {} as LanguageModel,
      minMessages: 20,
      persona: async () => ({ name: "Athena", content: "Persona" }),
      logger: { warn: vi.fn() },
      onCompact: (operation) => {
        compact = async () => {
          idleCompactions++;
          await operation();
        };
      },
    });
    plugin.init?.({ storage } as never);
    const runtime = createRuntime({ compact, storage });

    await finishTurn(runtime);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(idleCompactions).toBe(1);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect((await storage.read()).filter((entry) => entry.type === "compact")).toHaveLength(0);
  });

  it("compensates on init when the last persisted entry exceeds the idle timeout", async () => {
    const compact = vi.fn(async () => undefined);
    const runtime = createRuntime({ compact, storage: createMemoryStorage(messages(20, 0)) });

    await runtime.init();
    await vi.advanceTimersByTimeAsync(0);

    expect(compact).toHaveBeenCalledOnce();
  });

  it("clears a pending idle timer when stopped", async () => {
    const compact = vi.fn(async () => undefined);
    const runtime = createRuntime({ compact });

    await finishTurn(runtime);
    expect(vi.getTimerCount()).toBe(1);
    await runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(compact).not.toHaveBeenCalled();
  });
});
