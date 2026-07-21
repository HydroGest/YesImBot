import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeState = vi.hoisted(() => ({
  operations: [] as string[],
  handle: vi.fn(async () => undefined),
  reset: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  resetMocks() {
    this.operations = [];
    this.stop.mockReset();
    this.stop.mockImplementation(async () => {
      this.operations.push("runtime.stop");
    });
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

describe("service lifecycle", () => {
  beforeEach(() => runtimeState.resetMocks());

  it("disposes Koishi hooks before stopping the channel runtime once", async () => {
    const ctx = new Context();
    ctx.baseDir = "/tmp/yesimbot-channel-lifecycle";
    const disposeMiddleware = vi.fn(() => runtimeState.operations.push("middleware.dispose"));
    const disposeCommand = vi.fn(() => runtimeState.operations.push("command.dispose"));
    vi.spyOn(ctx, "middleware").mockReturnValue(disposeMiddleware as never);
    vi.spyOn(ctx, "command").mockReturnValue({
      action: vi.fn(),
      dispose: disposeCommand,
    } as never);
    Object.assign(ctx, {
      "yesimbot.model": {},
      "yesimbot.platform": {},
      "yesimbot.delivery": {},
    });
    const service = new YesImBotService(ctx as never, config);

    await service.stop();
    await service.stop();

    expect(disposeCommand).toHaveBeenCalledOnce();
    expect(disposeMiddleware).toHaveBeenCalledOnce();
    expect(runtimeState.stop).toHaveBeenCalledOnce();
    expect(runtimeState.operations.indexOf("runtime.stop")).toBeGreaterThan(
      runtimeState.operations.indexOf("command.dispose"),
    );
    expect(runtimeState.operations.indexOf("runtime.stop")).toBeGreaterThan(
      runtimeState.operations.indexOf("middleware.dispose"),
    );
  });
});
