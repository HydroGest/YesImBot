import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));
vi.mock("@yesimbot/agent-runtime", async (original) => {
  const actual = await original<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      init: vi.fn(),
      append: vi.fn(),
      send: vi.fn(),
      run: vi.fn(() => (async function* () {})()),
      getActiveTurnId: () => null,
      wait: vi.fn(),
      interrupt: vi.fn(),
      stop: vi.fn(),
      isIdle: () => true,
    })),
  };
});

import { Agents } from "../src/agents/index.js";
import { Channels } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import { Runtimes } from "../src/runtimes/index.js";

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
    compact: { threshold: 1, charTokenRatio: 1, minMessages: 1, maxFailures: 1, model: undefined },
    idle: { timeout: 1 },
  },
};

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
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents());
      const scopeOne = { type: "direct", platform: "test", selfId: "one", channelId: "room" } as const;
      const scopeTwo = { type: "direct", platform: "test", selfId: "two", channelId: "room" } as const;
      const [first, second] = await Promise.all([
        runtimes.get(await channels.resolve(scopeOne), { platform: "test", selfId: "one" } as never),
        runtimes.get(await channels.resolve(scopeTwo), { platform: "test", selfId: "two" } as never),
      ]);
      expect(first).not.toBe(second);
      expect(first.scope).toEqual(scopeOne);
      expect(second.scope).toEqual(scopeTwo);
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
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents());
      const scope = { type: "shared", platform: "test", channelId: "room" } as const;
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
      const runtimes = new Runtimes(ctx, channels, model as never, { ...config, basePath: root }, new Agents());
      const one = { type: "shared", platform: "test", channelId: "one" } as const;
      const two = { type: "shared", platform: "test", channelId: "two" } as const;
      const first = await runtimes.get(await channels.resolve(one), { platform: "test", selfId: "bot" } as never);
      const second = await runtimes.get(await channels.resolve(two), { platform: "test", selfId: "bot" } as never);
      expect(first).not.toBe(second);
      expect(first.scope).toEqual(one);
      expect(second.scope).toEqual(two);
      await runtimes.stop();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
