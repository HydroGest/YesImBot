import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeState = vi.hoisted(() => ({
  reset: vi.fn(async () => undefined),
  handle: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  resetMocks() {
    this.reset.mockReset();
    this.reset.mockResolvedValue(undefined);
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
import { YesImBotService } from "../src/runtime/service.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };
const scope = { platform: "test", selfId: "bot", channelId: "room" };

function createService() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-reset";
  Object.assign(ctx, {
    "yesimbot.model": {},
    "yesimbot.platform": {},
    "yesimbot.delivery": {},
  });
  return new YesImBotService(ctx as never, config);
}

describe("channel reset delegation", () => {
  beforeEach(() => runtimeState.resetMocks());

  it("delegates reset to the channel runtime", async () => {
    const service = createService();

    await service.resetChannel(scope);

    expect(runtimeState.reset).toHaveBeenCalledWith(scope);
  });
});
