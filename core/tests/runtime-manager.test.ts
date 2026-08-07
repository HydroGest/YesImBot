import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));
vi.mock("@yesimbot/agent-runtime", async (original) => {
  const actual = await original<typeof import("@yesimbot/agent-runtime")>();
  return { ...actual, createAgent: vi.fn(() => ({ init: vi.fn(), append: vi.fn(), send: vi.fn(), run: vi.fn(() => (async function* () {})()), getActiveTurnId: () => null, wait: vi.fn(), interrupt: vi.fn(), stop: vi.fn(), isIdle: () => true })) };
});

import { Agents } from "../src/agents/index.js";
import { Channels } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import { Runtimes } from "../src/runtimes/index.js";

const config: Config = { basePath: "/tmp", chatModel: "test:model", visionModel: undefined, logLevel: 2, allowedChannels: [], imageInput: false, resourceReadTimeoutMs: 1000, reply: { pacing: { charactersPerSecond: 1, maxTotalDelayMs: 1 }, customInnerThought: false }, session: { compact: { threshold: 1, charTokenRatio: 1, minMessages: 1, maxFailures: 1, model: undefined }, idle: { timeout: 1 } } };

describe("Runtimes identity", () => {
  it("serializes creation and replaces a shared runtime when Bot changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "yesimbot-runtimes-"));
    try {
      const ctx = new Context();
      const channels = new Channels(ctx, { basePath: root });
      const model = { resolveChatModel: vi.fn(() => ({ model: {} as never, entry: {} })) };
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents());
      const channel = await channels.resolve({ type: "shared", platform: "test", channelId: "room" });
      const botOne = { selfId: "one", platform: "test", sendMessage: vi.fn() };
      const botTwo = { selfId: "two", platform: "test", sendMessage: vi.fn() };
      const [first, same] = await Promise.all([runtimes.get(channel, botOne as never), runtimes.get(channel, botOne as never)]);
      expect(first).toBe(same);
      const replacement = await runtimes.get(channel, botTwo as never);
      expect(replacement).not.toBe(first);
      expect(replacement.scope).toEqual({ type: "shared", platform: "test", channelId: "room" });
      await runtimes.stop();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
