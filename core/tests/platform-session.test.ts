import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeState = vi.hoisted(() => ({
  instances: [] as unknown[],
  handle: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  resetMocks() {
    this.instances = [];
    this.handle.mockReset();
    this.handle.mockResolvedValue(undefined);
    this.reset.mockReset();
    this.reset.mockResolvedValue(undefined);
    this.stop.mockReset();
    this.stop.mockResolvedValue(undefined);
  },
}));

vi.mock("../src/runtime/channel-runtime.js", () => ({
  ChannelRuntime: class {
    constructor() {
      runtimeState.instances.push(this);
    }

    handle = runtimeState.handle;
    reset = runtimeState.reset;
    stop = runtimeState.stop;
  },
}));

import type { Config } from "../src/config.js";
import { draftMessageFromSession } from "../src/platform/message.js";
import type { Platform } from "../src/platform/types.js";
import { YesImBotService } from "../src/runtime/service.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };

function message(): Platform.Message {
  return {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room", channelType: "group" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements: [],
  };
}

function createService(input: Platform.Message) {
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-platform-session";
  const platform = {
    getMessage: vi.fn(() => input),
    collectIfNeeded: vi.fn(),
  };
  Object.assign(ctx, {
    "yesimbot.model": {},
    "yesimbot.platform": platform,
    "yesimbot.delivery": {},
  });
  return new YesImBotService(ctx as never, config);
}

describe("platform session collection", () => {
  beforeEach(() => runtimeState.resetMocks());

  it("captures directness from the real Session accessor", () => {
    const input = Object.create({
      get isDirect() {
        return true;
      },
    }) as import("koishi").Session;
    Object.assign(input, {
      platform: "test",
      selfId: "bot",
      channelId: "dm-user",
      userId: "user",
      messageId: "m1",
      content: "hello",
    });

    const collected = draftMessageFromSession(input, 10)!;

    expect(Object.hasOwn(input, "isDirect")).toBe(false);
    expect(collected.scope.channelType).toBe("private");
  });

  it("delegates the canonical message and original Session to the channel runtime", async () => {
    const canonical = message();
    const service = createService(canonical);
    const original = { platform: "raw", send: vi.fn(async () => ["raw-message"]) } as never;
    const next = vi.fn(async () => undefined);

    expect(runtimeState.instances).toHaveLength(1);
    await service.handleSession(original, next);

    expect(runtimeState.handle).toHaveBeenCalledWith(canonical, original);
    expect(next).toHaveBeenCalledOnce();
  });
});
