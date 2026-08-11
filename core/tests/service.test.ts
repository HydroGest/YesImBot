import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Config } from "../src/config.js";
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
  customInnerThought: false,
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

  it("exposes exactly the four approved domain entries", () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
    const service = new YesImBotService(ctx as never, { ...config, basePath: join(tmpdir(), `yesimbot-service-${randomUUID()}`) });

    expect(service.model).toBeDefined();
    expect(service.messenger).toMatchObject({ use: expect.any(Function), post: expect.any(Function) });
    expect(service.agent).toMatchObject({ use: expect.any(Function), will: expect.any(Function) });
    expect(service.resource).toMatchObject({ get: expect.any(Function), use: expect.any(Function) });
    expect("trigger" in service).toBe(false);
    expect("reset" in service).toBe(false);
    expect("assets" in service).toBe(false);
    expect("getStoragePath" in service).toBe(false);
  });
  it("threads image input and converts resource timeout seconds", async () => {
    vi.useFakeTimers();
    try {
      const ctx = new Context();
      ctx.baseDir = tmpdir();
      Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
      const basePath = join(tmpdir(), `yesimbot-service-config-${randomUUID()}`);
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
