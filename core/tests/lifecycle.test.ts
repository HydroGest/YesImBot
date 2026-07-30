import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  order: [] as string[],
  stop: vi.fn(async () => undefined),
}));

vi.mock("../src/runtime/index.js", () => ({
  RuntimeManager: class {
    reset = vi.fn(async () => undefined);
    stop = vi.fn(async () => {
      state.order.push("runtime.stop");
      return state.stop();
    });
  },
}));

vi.mock("../src/gateway.js", () => ({
  Gateway: class {
    register = vi.fn(() => vi.fn());
    close = vi.fn(() => state.order.push("gateway.close"));
    drain = vi.fn(async () => state.order.push("gateway.drain"));
  },
}));

import type { Config } from "../src/config.js";
import { YesImBotService } from "../src/service.js";

const config: Config = {
  basePath: "data/yesimbot-lifecycle",
  chatModel: "mock:model",
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
  reply: { pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 } },
};

describe("YesImBotService lifecycle", () => {
  it("closes Gateway, stops runtimes, then drains Gateway for each stop request", async () => {
    state.order.length = 0;
    const ctx = new Context();
    ctx.baseDir = "/tmp/yesimbot-lifecycle";
    Object.assign(ctx, { "yesimbot.model": {} });
    vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
    vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
    vi.spyOn(ctx, "command").mockReturnValue({ action: vi.fn(), dispose: vi.fn() } as never);
    const service = new YesImBotService(ctx as never, config);

    await service.stop();
    await service.stop();

    expect(state.order).toEqual([
      "gateway.close",
      "runtime.stop",
      "gateway.drain",
      "gateway.close",
      "runtime.stop",
      "gateway.drain",
    ]);
  });

  it("drains Gateway after a runtime stop rejection and command disposal failure", async () => {
    state.order.length = 0;
    state.stop.mockRejectedValueOnce(new Error("runtime stop failed"));
    const ctx = new Context();
    ctx.baseDir = "/tmp/yesimbot-lifecycle";
    Object.assign(ctx, { "yesimbot.model": {} });
    vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
    vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
    vi.spyOn(ctx, "command").mockReturnValue({
      action: vi.fn(),
      dispose: vi.fn(() => {
        throw new Error("command dispose failed");
      }),
    } as never);
    const service = new YesImBotService(ctx as never, config);

    await expect(service.stop()).resolves.toBeUndefined();

    expect(state.order).toEqual(["gateway.close", "runtime.stop", "gateway.drain"]);
  });
});
