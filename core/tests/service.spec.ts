import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelContext } from "../src/channels/index.js";
import type { Config } from "../src/config.js";
import type { ConversationReadOptions } from "../src/conversations/index.js";
import YesImBotService from "../src/index.js";

const config: Config = {
  basePath: "data/yesimbot",
  chatModel: "test:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  resourceReadTimeout: 30,
  pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
  customInnerThought: true,
  session: { compact: { responseIdleMinutes: 0, minMessages: 20, maxFailures: 3, model: undefined }, archive: { maxKB: 0 } },
};

describe("YesImBotService facade", () => {
  it("accepts a null plugin config and applies schema defaults", () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });

    const service = new YesImBotService(ctx as never, null as never);

    expect((service as unknown as { config: Config }).config.logLevel).toBe(2);
  });

  it("exposes only narrow domain entries", () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
    const service = new YesImBotService(ctx as never, { ...config, basePath: path.join(tmpdir(), `yesimbot-service-${randomUUID()}`) });

    expect(service.model).toBeDefined();
    expect(service.messenger).toMatchObject({ use: expect.any(Function), post: expect.any(Function) });
    expect(service.agent).toMatchObject({ use: expect.any(Function), will: expect.any(Function) });
    expect(service.resource).toMatchObject({ get: expect.any(Function), use: expect.any(Function) });
    expect(service.conversation).toMatchObject({ read: expect.any(Function) });
    expect("trigger" in service).toBe(false);
    expect("reset" in service).toBe(false);
    expect("assets" in service).toBe(false);
    expect("getStoragePath" in service).toBe(false);
  });

  it("delegates conversation reads to the resolved channel", async () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
    const service = new YesImBotService(ctx as never, { ...config, basePath: path.join(tmpdir(), `yesimbot-service-${randomUUID()}`) });
    const context: ChannelContext = { type: "guild", platform: "test", channelId: "room", guildId: "room" };
    const options: ConversationReadOptions = { limit: 2 };
    const result = [{ messageId: "message" }];
    const resolve = vi.fn().mockResolvedValue({ conversation: { read: vi.fn().mockResolvedValue(result) } });
    (service as unknown as { channels: { resolve: typeof resolve } }).channels.resolve = resolve;

    await expect(service.conversation.read(context, options)).resolves.toEqual(result);
    expect(resolve).toHaveBeenCalledWith(context);
  });
  it("threads image input and converts resource timeout seconds", async () => {
    vi.useFakeTimers();
    try {
      const ctx = new Context();
      ctx.baseDir = tmpdir();
      Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
      const basePath = path.join(tmpdir(), `yesimbot-service-config-${randomUUID()}`);
      const service = new YesImBotService(ctx as never, { ...config, basePath, imageInput: true, resourceReadTimeout: 1 });
      const resources = await service.resource.get({ type: "guild", platform: "test", channelId: "room", guildId: "room" });
      resources.use({ scheme: "slow", prompt: "slow reader", setup: async () => Promise.withResolvers<never>().promise });
      const controller = new AbortController();
      let cause: unknown;
      void resources.openStrict("slow:///file", controller.signal).catch((error: unknown) => {
        cause = error;
      });
      try {
        expect(resources.imageInput).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(cause).toMatchObject({ code: "timeout" });
      } finally {
        controller.abort();
        await vi.runAllTimersAsync();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
