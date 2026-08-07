import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({ active: null as string | null, append: vi.fn(), send: vi.fn(), run: vi.fn(), decide: vi.fn(), observe: vi.fn() }));
vi.mock("@yesimbot/agent-runtime", async (original) => {
  const actual = await original<typeof import("@yesimbot/agent-runtime")>();
  return { ...actual, createAgent: vi.fn(() => ({ init: vi.fn(), append: state.append, send: state.send, run: state.run, getActiveTurnId: () => state.active, wait: vi.fn(), interrupt: vi.fn(), stop: vi.fn(), isIdle: () => true })) };
});

import { Channel } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import { ChannelRuntime } from "../src/runtimes/channel.js";

const config: Config = { basePath: "/tmp", chatModel: "test:model", visionModel: undefined, logLevel: 2, allowedChannels: [], imageInput: false, resourceReadTimeoutMs: 1000, reply: { pacing: { charactersPerSecond: 1, maxTotalDelayMs: 1 }, customInnerThought: false }, session: { compact: { threshold: 1, charTokenRatio: 1, minMessages: 1, maxFailures: 1, model: undefined }, idle: { timeout: 1 } } };
const event = { eventType: "delivery.failed", platform: "test", selfId: "bot", timestamp: 1, channel: { id: "room", type: 0 }, text: "failure", delivery: { turnId: "t", messageId: "m", segmentIndex: 0, segmentTotal: 1, error: { name: "Error", message: "x" } } } as const;

async function runtime() {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-runtime-"));
  const channel = new Channel({ type: "shared", platform: "test", channelId: "room" }, root);
  await channel.conversation.init();
  const value = new ChannelRuntime(new Context(), { channel, bot: { selfId: "bot", sendMessage: vi.fn() } as never, will: { decide: state.decide, observe: state.observe } as never, model: {} as never, imageOutputSupported: false, config, plugins: [] });
  await value.init();
  return { value, root };
}

describe("ChannelRuntime scheduling", () => {
  beforeEach(() => { state.active = null; state.append.mockReset().mockResolvedValue(undefined); state.send.mockReset(); state.run.mockReset().mockReturnValue((async function* () {})()); state.decide.mockReset().mockResolvedValue("wait"); state.observe.mockReset(); });
  it("commits trigger false without Will or a turn", async () => {
    const { value, root } = await runtime();
    try { await expect(value.post(event, { trigger: false, ifBusy: "join" })).resolves.toMatchObject({ kind: "wait" }); expect(state.append).toHaveBeenCalledTimes(1); expect(state.decide).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled(); expect(state.run).not.toHaveBeenCalled(); } finally { await value.stop(); await rm(root, { recursive: true, force: true }); }
  });
  it("rejects before append when busy", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try { await expect(value.post(event, { ifBusy: "reject" })).rejects.toThrow(); expect(state.append).not.toHaveBeenCalled(); } finally { await value.stop(); await rm(root, { recursive: true, force: true }); }
  });
  it("joins the active turn without a second run consumer", async () => {
    state.active = "active";
    const { value, root } = await runtime();
    try { await expect(value.post(event, { ifBusy: "join" })).resolves.toEqual({ kind: "join", eventId: expect.any(String), turnId: "active" }); expect(state.send).toHaveBeenCalledOnce(); expect(state.run).not.toHaveBeenCalled(); } finally { await value.stop(); await rm(root, { recursive: true, force: true }); }
  });
});
