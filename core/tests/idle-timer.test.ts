import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import type * as AgentRuntime from "@yesimbot/agent-runtime";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ active: null as string | null }));

vi.mock("koishi", async () => import("@koishijs/core"));
vi.mock("@yesimbot/agent-runtime", async (original) => {
  const actual = await original<typeof AgentRuntime>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      init: vi.fn(),
      append: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      run: vi.fn(() => (async function* () {})()),
      getActiveTurnId: () => state.active,
      wait: vi.fn(),
      interrupt: vi.fn(),
      stop: vi.fn(),
      isIdle: () => true,
    })),
  };
});

import { Channel } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import { ChannelRuntime } from "../src/runtimes/channel.js";

const config: Config = {
  basePath: "/tmp",
  chatModel: "test:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  resourceReadTimeoutMs: 1000,
  reply: { pacing: { charactersPerSecond: 1, maxTotalDelayMs: 1 }, customInnerThought: false },
  session: {
    compact: { threshold: 1, charTokenRatio: 1, minMessages: 20, maxFailures: 1, model: undefined },
    idle: { timeout: 10 },
  },
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

async function createRuntime() {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-idle-"));
  const channel = new Channel({ type: "shared", platform: "test", channelId: "room" }, root);
  await channel.conversation.init();
  const value = new ChannelRuntime(new Context(), {
    channel,
    bot: { selfId: "bot", sendMessage: vi.fn() } as never,
    will: { decide: vi.fn().mockResolvedValue("wait"), observe: vi.fn() } as never,
    model: {} as never,
    imageOutputSupported: false,
    idleTimeout: config.session.idle.timeout,
    config,
    plugins: [],
  });
  await value.init();
  return { value, channel, root };
}

describe("ChannelRuntime idle compaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.active = null;
  });
  afterEach(() => vi.useRealTimers());

  it("compacts after a completed record becomes idle", async () => {
    const { value, channel, root } = await createRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      await value.post(event, { trigger: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(compact).toHaveBeenCalledWith("idle", expect.anything());
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restarts the idle timeout after a new record", async () => {
    const { value, channel, root } = await createRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      await value.post(event, { trigger: false });
      await vi.advanceTimersByTimeAsync(5);
      await value.post({ ...event, timestamp: 2 }, { trigger: false });
      await vi.advanceTimersByTimeAsync(5);
      expect(compact).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5);
      expect(compact).toHaveBeenCalledOnce();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips expiry while an Agent turn is active", async () => {
    const { value, channel, root } = await createRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    try {
      state.active = "turn-1";
      await value.post(event, { trigger: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(compact).not.toHaveBeenCalled();
    } finally {
      await value.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clears the pending idle timer when stopped", async () => {
    const { value, channel, root } = await createRuntime();
    const compact = vi.spyOn(channel.conversation, "compact").mockResolvedValue({ compacted: false });
    await value.post(event, { trigger: false });
    await value.stop();
    await vi.advanceTimersByTimeAsync(20);
    expect(compact).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });
});
