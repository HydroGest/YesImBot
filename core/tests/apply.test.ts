import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeMocks = vi.hoisted(() => ({
  append: vi.fn(async () => undefined),
  createAgent: vi.fn(() => ({
    id: "runtime",
    channel: { emit: vi.fn(), subscribe: vi.fn(() => () => undefined) },
    storage: {} as never,
    state: {} as never,
    init: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    append: runtimeMocks.append,
    send: vi.fn(() => "turn"),
    run: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    wait: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    setTools: vi.fn(),
    getModel: vi.fn(),
    setModel: vi.fn(),
    clear: vi.fn(async () => undefined),
    getActiveTurnId: vi.fn(() => null),
    isIdle: vi.fn(() => true),
  })),
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return { ...actual, createAgent: runtimeMocks.createAgent };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: vi.fn(async () => undefined),
  })),
}));

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>();
  return { ...actual, ensureChannelScopeRecord: vi.fn(async () => undefined) };
});

import { apply } from "../src/index.js";
import { PlatformService } from "../src/platform/service.js";

describe("core apply", () => {
  it("routes the first production message through ctx.yesimbot.platform", async () => {
    const ctx = new Context();
    ctx.baseDir = "/tmp/yesimbot-apply";
    apply(ctx as never, {
      basePath: "data",
      chatModel: "mock:model",
      logLevel: 2,
    });
    vi.spyOn(ctx["yesimbot.model"], "resolveChatModel").mockReturnValue({
      model: { modelId: "mock:model" },
    } as never);

    const publicPlatform = ctx.yesimbot.platform;
    const internalPlatform = ctx["yesimbot.platform"];
    expect([
      publicPlatform instanceof PlatformService,
      internalPlatform instanceof PlatformService,
    ]).toEqual([true, true]);
    await ctx.yesimbot.handleSession({
      platform: "test",
      selfId: "bot",
      channelId: "room",
      userId: "user",
      messageId: "m1",
      content: "observation",
      send: vi.fn(async () => undefined),
    } as never);

    expect(runtimeMocks.append).toHaveBeenCalledOnce();
  });
});
