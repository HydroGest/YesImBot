import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import type { ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ active: null as string | null, append: vi.fn(), send: vi.fn(), run: vi.fn(), decide: vi.fn(), observe: vi.fn() }));

vi.mock("koishi", async () => import("@koishijs/core"));
vi.mock("@yesimbot/agent-runtime", async (original) => {
  const actual = await original<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      init: vi.fn(),
      append: state.append,
      send: state.send,
      run: state.run,
      getActiveTurnId: () => state.active,
      wait: vi.fn(),
      interrupt: vi.fn(),
      stop: vi.fn(),
      isIdle: () => true,
    })),
  };
});

import { createAgent, createEntry } from "@yesimbot/agent-runtime";

import { Agents } from "../src/agents/index.js";
import { Channel, Channels } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import { ChannelRuntime } from "../src/runtimes/channel.js";
import { Runtimes } from "../src/runtimes/index.js";

const config: Config = {
  basePath: "/tmp",
  chatModel: "test:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  resourceReadTimeout: 1,
  pacing: { charactersPerSecond: 1, maxTotalDelayMs: 1 },
  customInnerThought: false,
  session: { compact: { responseIdleMinutes: 0, minMessages: 1, maxFailures: 1, model: undefined }, archive: { maxKB: 0 } },
};

const event = {
  eventType: "delivery.failed",
  platform: "test",
  selfId: "bot",
  timestamp: 1,
  channel: { id: "room", type: 0 },
  text: "failure",
  delivery: { turnId: "t", messageId: "m", segmentIndex: 0, segmentTotal: 1, error: { name: "Error", message: "x" } },
} as const;

// ---------------------------------------------------------------------------
// ChannelRuntime scheduling
// ---------------------------------------------------------------------------

async function runtime(providerTools?: ToolSet) {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-runtime-"));
  const channel = new Channel({ type: "guild", platform: "test", channelId: "room", guildId: "room" }, root);
  await channel.conversation.init();
  const value = new ChannelRuntime(new Context(), {
    channel,
    bot: { selfId: "bot", sendMessage: vi.fn() } as never,
    will: { decide: state.decide, observe: state.observe } as never,
    model: {} as never,
    imageOutputSupported: false,
    config,
    plugins: [],
    providerTools,
  });
  await value.init();
  return { value, root };
}

describe("ChannelRuntime scheduling", () => {
  beforeEach(() => {
    state.active = null;
    vi.mocked(createAgent).mockClear();
    state.append.mockReset().mockResolvedValue(undefined);
    state.send.mockReset();
    state.run.mockReset().mockReturnValue((async function* () {})());
    state.decide.mockReset().mockResolvedValue("wait");
    state.observe.mockReset();
  });
  it("passes provider-executed tools to the Agent without local execution", async () => {
    const providerTools = { web_search: { type: "provider", id: "test.web_search", inputSchema: {} as never } } as ToolSet;
    const { value, root } = await runtime(providerTools);
    try {
      const config = vi.mocked(createAgent).mock.calls.at(-1)?.[0];
      expect(config?.providerTools).toBe(providerTools);
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("projects the latest compact summary into model-visible history", async () => {
    const { value, root } = await runtime();
    try {
      const plugin = vi
        .mocked(createAgent)
        .mock.calls.at(-1)?.[0]
        .plugins?.find((item) => item.name === "core.compact-history");
      const entries = await plugin?.transformEntries?.([
        createEntry("message", { id: "old", timestamp: 1, role: "user", content: "old" }),
        createEntry("compact", { summary: "remember this", lastEntryId: "old", sourceSession: "session" }),
        createEntry("message", { id: "new", timestamp: 2, role: "user", content: "new" }),
      ]);
      expect(entries).toHaveLength(2);
      expect(entries?.[0]).toMatchObject({ type: "message", data: { role: "system", content: expect.stringContaining("remember this") } });
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("commits trigger false without Will or a turn", async () => {
    const { value, root } = await runtime();
    try {
      await expect(value.post(event, { trigger: false, ifBusy: "join" })).resolves.toMatchObject({ kind: "wait" });
      expect(state.append).toHaveBeenCalledTimes(1);
      expect(state.decide).not.toHaveBeenCalled();
      expect(state.send).not.toHaveBeenCalled();
      expect(state.run).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects before append when busy", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try {
      await expect(value.post(event, { ifBusy: "reject" })).rejects.toThrow();
      expect(state.append).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("joins the active turn without a second run consumer", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try {
      await expect(value.post(event, { ifBusy: "join" })).resolves.toEqual({ kind: "join", eventId: expect.any(String), turnId: "active" });
      expect(state.send).toHaveBeenCalledOnce();
      expect(state.run).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("runs an active post through one filtered output stream without Will", async () => {
    state.run.mockReturnValue(
      (async function* () {
        yield { type: "message.appended", turnId: "turn-1", message: { role: "assistant", id: "message-1", content: "reply" } };
      })(),
    );
    const { value, root } = await runtime();
    try {
      const result = await value.post(event);
      expect(result.kind).toBe("run");
      if (result.kind === "run") {
        await expect(Array.fromAsync(result.output)).resolves.toEqual([
          { turnId: "turn-1", messageId: "message-1", segments: [[expect.objectContaining({ type: "text", attrs: { content: "reply" } })]] },
        ]);
      }
      expect(state.decide).not.toHaveBeenCalled();
      expect(state.run).toHaveBeenCalledOnce();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs passive trigger and observes only after the output stream ends", async () => {
    state.decide.mockResolvedValue("trigger");
    state.run.mockReturnValue(
      (async function* () {
        yield { type: "message.appended", turnId: "turn-1", message: { role: "assistant", id: "message-1", content: "reply" } };
      })(),
    );
    const { value, root } = await runtime();
    try {
      const result = await value.handle(event);
      expect(result.kind).toBe("run");
      if (result.kind === "run") await Array.fromAsync(result.output);
      expect(state.decide).toHaveBeenCalledOnce();
      expect(state.observe).toHaveBeenCalledWith(expect.objectContaining({ turnId: "turn-1", status: "done" }));
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records delivery failure through the same Runtime FIFO", async () => {
    const { value, root } = await runtime();
    try {
      await value.fail("event-1", new Error("offline"), { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 2, segmentTotal: 3 });
      expect(state.append).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "delivery.failed",
            delivery: expect.objectContaining({ turnId: "turn-1", messageId: "assistant-1", segmentIndex: 2, segmentTotal: 3 }),
          }),
        }),
      );
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("returns wait without running the Agent when passive Will waits", async () => {
    const { value, root } = await runtime();
    try {
      await expect(value.handle(event)).resolves.toMatchObject({ kind: "wait" });
      expect(state.run).not.toHaveBeenCalled();
      expect(state.observe).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("continues FIFO work after a rejected busy operation", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try {
      await expect(value.post(event, { ifBusy: "reject" })).rejects.toThrow();
      state.active = null;
      state.run.mockReturnValue((async function* () {})());
      await expect(value.post(event)).resolves.toMatchObject({ kind: "run" });
      expect(state.append).toHaveBeenCalledOnce();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps one output consumer for a joined active turn", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try {
      await expect(value.post(event, { ifBusy: "join" })).resolves.toMatchObject({ kind: "join", turnId: "active" });
      expect(state.run).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ChannelRuntime response-idle compaction
// ---------------------------------------------------------------------------

const responseConfig: Config = {
  ...config,
  session: { compact: { responseIdleMinutes: 1, minMessages: 20, maxFailures: 1, model: undefined }, archive: { maxKB: 0 } },
};

async function createResponseRuntime(archiveMaxBytes = 0) {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-response-idle-"));
  const channel = new Channel({ type: "guild", platform: "test", channelId: "room", guildId: "room" }, root);
  await channel.conversation.init();
  const value = new ChannelRuntime(new Context(), {
    channel,
    bot: { selfId: "bot", sendMessage: vi.fn() } as never,
    will: { decide: vi.fn().mockResolvedValue("wait"), observe: vi.fn() } as never,
    model: {} as never,
    imageOutputSupported: false,
    idleTimeout: 10,
    archiveMaxBytes,
    config: responseConfig,
    plugins: [],
  });
  await value.init();
  return { value, channel, root };
}

function completedReply() {
  return (async function* () {
    yield { type: "message.appended", turnId: "turn-1", message: { role: "assistant", id: "message-1", content: "reply" } };
  })();
}

describe("ChannelRuntime response-idle compaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.active = null;
    state.append.mockReset().mockResolvedValue(undefined);
    state.send.mockReset();
    state.run.mockReset().mockReturnValue((async function* () {})());
  });
  afterEach(() => vi.useRealTimers());

  it("does not compact after a record that produced no response", async () => {
    const { value, channel, root } = await createResponseRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      await value.post(event, { trigger: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(compact).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("checks file size after a record even when it produced no response", async () => {
    const { value, channel, root } = await createResponseRuntime(1);
    const archive = vi.spyOn(channel.conversation, "archiveIfOversize").mockResolvedValue(false);
    try {
      await value.post(event, { trigger: false });
      expect(archive).toHaveBeenCalledWith(1, expect.objectContaining({ personaName: "Athena" }));
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compacts after a completed assistant response becomes idle", async () => {
    state.run.mockReturnValue(completedReply());
    const { value, channel, root } = await createResponseRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      const result = await value.post(event);
      if (result.kind === "run") await Array.fromAsync(result.output);
      await vi.advanceTimersByTimeAsync(10);
      expect(compact).toHaveBeenCalledWith("idle", expect.anything());
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not reset response-idle timing for a new non-response record", async () => {
    state.run.mockReturnValue(completedReply());
    const { value, channel, root } = await createResponseRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      const result = await value.post(event);
      if (result.kind === "run") await Array.fromAsync(result.output);
      await vi.advanceTimersByTimeAsync(5);
      await value.post({ ...event, timestamp: 2 }, { trigger: false });
      await vi.advanceTimersByTimeAsync(5);
      expect(compact).toHaveBeenCalledOnce();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clears the pending response-idle timer when stopped", async () => {
    state.run.mockReturnValue(completedReply());
    const { value, channel, root } = await createResponseRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      const result = await value.post(event);
      if (result.kind === "run") await Array.fromAsync(result.output);
      await value.stop();
      await vi.advanceTimersByTimeAsync(20);
      expect(compact).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Runtimes identity
// ---------------------------------------------------------------------------

describe("Runtimes identity", () => {
  it("serializes creation and replaces a shared runtime when Bot changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents(ctx));
      const channel = await channels.resolve({ type: "guild", platform: "test", channelId: "room", guildId: "room" });
      const botOne = { selfId: "one", platform: "test", sendMessage: vi.fn() };
      const botTwo = { selfId: "two", platform: "test", sendMessage: vi.fn() };
      const [first, same] = await Promise.all([runtimes.get(channel, botOne as never), runtimes.get(channel, botOne as never)]);
      expect(first).toBe(same);
      const replacement = await runtimes.get(channel, botTwo as never);
      expect(replacement).not.toBe(first);
      expect(replacement.context).toEqual({ type: "guild", platform: "test", channelId: "room", guildId: "room" });
      await runtimes.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps direct runtimes isolated by selfId", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents(ctx));
      const scopeOne = { type: "direct", platform: "test", selfId: "one", userId: "user-1", channelId: "room" } as const;
      const scopeTwo = { type: "direct", platform: "test", selfId: "two", userId: "user-1", channelId: "room" } as const;
      const [first, second] = await Promise.all([
        runtimes.get(await channels.resolve(scopeOne), { platform: "test", selfId: "one" } as never),
        runtimes.get(await channels.resolve(scopeTwo), { platform: "test", selfId: "two" } as never),
      ]);
      expect(first).not.toBe(second);
      expect(first.context).toEqual(scopeOne);
      expect(second.context).toEqual(scopeTwo);
      await runtimes.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recreates a runtime after reset and rejects new admission after stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents(ctx));
      const scope = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;
      const bot = { platform: "test", selfId: "one" };
      const first = await runtimes.get(await channels.resolve(scope), bot as never);
      await runtimes.reset(scope);
      const second = await runtimes.get(await channels.resolve(scope), bot as never);
      expect(second).not.toBe(first);
      await runtimes.stop();
      await expect(runtimes.get(await channels.resolve(scope), bot as never)).rejects.toThrow("stopped");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("keeps different shared channel identities isolated", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents(ctx));
      const one = { type: "guild", platform: "test", channelId: "one", guildId: "one" } as const;
      const two = { type: "guild", platform: "test", channelId: "two", guildId: "two" } as const;
      const first = await runtimes.get(await channels.resolve(one), { platform: "test", selfId: "bot" } as never);
      const second = await runtimes.get(await channels.resolve(two), { platform: "test", selfId: "bot" } as never);
      expect(first).not.toBe(second);
      expect(first.context).toEqual(one);
      expect(second.context).toEqual(two);
      await runtimes.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("Runtimes status", () => {
  it("reports active session details from its persisted entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents(ctx));
      const scope = { type: "guild", platform: "test", channelId: "room", guildId: "room" } as const;
      const conversation = (await channels.resolve(scope)).conversation;
      await conversation.storage.append(
        createEntry("message", { id: "before", timestamp: 1, role: "user", content: "before" }),
        createEntry("compact", { summary: "summary", lastEntryId: "before", sourceSession: "old" }),
        createEntry("message", { id: "after", timestamp: 1_723_456_789_000, role: "assistant", content: "after" }),
      );

      await expect(runtimes.status(scope)).resolves.toMatch(
        /^活动会话：\d{8}T\d{6}Z\.jsonl\n消息：2\n压缩：1\n最后活跃：\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n自上次压缩以来消息：1\n连续失败：0\n文件大小：\d+ B$/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
