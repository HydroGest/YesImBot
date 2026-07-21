import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeState = vi.hoisted(() => ({
  handle: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  resetMocks() {
    this.handle.mockReset();
    this.reset.mockReset();
    this.stop.mockReset();
  },
}));

vi.mock("../src/runtime/channel-runtime.js", () => ({
  ChannelRuntime: class {
    handle = runtimeState.handle;
    reset = runtimeState.reset;
    stop = runtimeState.stop;
  },
}));

import type { Config } from "../src/config.js";
import type { Platform } from "../src/platform/types.js";
import { YesImBotService } from "../src/runtime/service.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };

function createService() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-error-handling";
  const message: Platform.Message = {
    source: { platform: "test", selfId: "bot" },
    scope: { type: "channel", channelId: "room", channelType: "private" },
    sender: { id: "user" },
    messageId: "m1",
    receivedAt: 1,
    elements: [],
  };
  Object.assign(ctx, {
    "yesimbot.model": {},
    "yesimbot.platform": { getMessage: () => message, collectIfNeeded: vi.fn() },
    "yesimbot.delivery": {},
  });
  return new YesImBotService(ctx as never, config);
}

describe("service error boundary", () => {
  beforeEach(() => runtimeState.resetMocks());

  it("continues Koishi middleware after delegated runtime failure", async () => {
    const service = createService();
    const failure = new Error("runtime failure");
    runtimeState.handle.mockRejectedValueOnce(failure);
    const next = vi.fn(async () => undefined);

    await expect(service.handleSession({} as never, next)).rejects.toBe(failure);

    expect(next).toHaveBeenCalledOnce();
  });
});
