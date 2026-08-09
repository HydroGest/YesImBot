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
  resourceReadTimeoutMs: 30_000,
  reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 }, customInnerThought: false },
  session: { compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined }, idle: { timeout: 0 } },
};

describe("YesImBotService facade", () => {
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
  it("threads configured image input budget into channel resources", async () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
    const basePath = join(tmpdir(), `yesimbot-service-config-${randomUUID()}`);
    const service = new YesImBotService(ctx as never, {
      ...config,
      basePath,
      imageInput: { maxCount: 2, maxBytesPerImage: 123, maxTotalBytes: 456 },
      resourceReadTimeoutMs: 789,
    });

    await expect(service.resource.get({ type: "shared", platform: "test", channelId: "room" })).resolves.toMatchObject({
      imageBudget: { maxCount: 2, maxBytesPerImage: 123, maxTotalBytes: 456 },
    });
  });

  it("defaults image input budget when the option is omitted", async () => {
    const ctx = new Context();
    ctx.baseDir = tmpdir();
    Object.assign(ctx, { "yesimbot.model": {}, database: { get: vi.fn() } });
    const basePath = join(tmpdir(), `yesimbot-service-default-${randomUUID()}`);
    const service = new YesImBotService(ctx as never, { ...config, basePath, imageInput: undefined });

    await expect(service.resource.get({ type: "shared", platform: "test", channelId: "room" })).resolves.toMatchObject({
      imageBudget: { maxCount: 3, maxBytesPerImage: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 },
    });
  });
});
