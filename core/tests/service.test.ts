import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  gateway: undefined as
    | {
        register: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        drain: ReturnType<typeof vi.fn>;
      }
    | undefined,
  runtime: undefined as
    | {
        setWill: ReturnType<typeof vi.fn>;
        reset: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        options: { getAgentPluginFactories(): readonly AgentPluginFactory[] };
      }
    | undefined,
}));

vi.mock("../src/runtime/manager.js", () => ({
  RuntimeManager: class {
    setWill = vi.fn();
    reset = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);

    constructor(readonly options: { getAgentPluginFactories(): readonly AgentPluginFactory[] }) {
      state.runtime = this;
    }
  },
}));

vi.mock("../src/gateway/index.js", () => ({
  Gateway: class {
    register = vi.fn(() => vi.fn());
    close = vi.fn();
    drain = vi.fn(async () => undefined);

    constructor() {
      state.gateway = this;
    }
  },
}));

import type { Config } from "../src/config.js";
import type { AgentPluginFactory } from "../src/index.js";
import { YesImBotService } from "../src/service.js";

const config: Config = { basePath: "data/yesimbot-service", chatModel: "mock:model" };

function createService() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-service";
  Object.assign(ctx, { "yesimbot.model": {} });
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "command").mockReturnValue({ action: vi.fn(), dispose: vi.fn() } as never);
  const service = new YesImBotService(ctx as never, config);
  Object.assign(ctx, { yesimbot: service });
  return { ctx, service };
}

describe("YesImBotService facade", () => {
  beforeEach(() => {
    state.gateway = undefined;
    state.runtime = undefined;
  });

  it("exposes only the confirmed facade", () => {
    const { ctx } = createService();

    expect(ctx.yesimbot.model).toBeDefined();
    expect(ctx.yesimbot.registerResolver).toEqual(expect.any(Function));
    expect(ctx.yesimbot.registerWill).toEqual(expect.any(Function));
    expect(ctx.yesimbot.registerAgentPlugin).toEqual(expect.any(Function));
    expect(ctx.yesimbot.reset).toEqual(expect.any(Function));
    expect(ctx.yesimbot.stop).toEqual(expect.any(Function));
    expect("assets" in ctx.yesimbot).toBe(false);
    expect("runtime" in ctx.yesimbot).toBe(false);
    expect("gateway" in ctx.yesimbot).toBe(false);
    expect(Object.keys(ctx.yesimbot)).not.toContain("config");
    expect("platform" in ctx.yesimbot).toBe(false);
    expect("delivery" in ctx.yesimbot).toBe(false);
  });

  it("accepts the public AgentPluginFactory context", () => {
    const factory: AgentPluginFactory = async ({ channel, bot }) => ({
      name: `plugin-${channel.platform}`,
      tools: bot ? [] : [],
    });

    expect(factory).toBeTypeOf("function");
  });

  it("delegates resolver and reset registration to the composed boundaries", async () => {
    const { service } = createService();
    const resolver = { platform: "test", resolve: vi.fn() };
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1" };

    service.registerResolver(resolver);
    await service.reset(scope);

    expect(state.gateway?.register).toHaveBeenCalledWith(resolver);
    expect(state.runtime?.reset).toHaveBeenCalledWith(scope);
  });

  it("restores the active Will factory through identity-safe registration disposal", () => {
    const { service } = createService();
    const firstWill = vi.fn();
    const secondWill = vi.fn();

    const disposeFirstWill = service.registerWill(firstWill);
    const disposeSecondWill = service.registerWill(secondWill);
    disposeSecondWill();
    expect(state.runtime?.setWill).toHaveBeenLastCalledWith(firstWill);
    disposeFirstWill();
    expect(state.runtime?.setWill).not.toHaveBeenLastCalledWith(firstWill);
    expect(state.runtime?.setWill).not.toHaveBeenLastCalledWith(secondWill);
  });

  it("keeps an older Will disposer from replacing a newer active factory", () => {
    const { service } = createService();
    const firstWill = vi.fn();
    const secondWill = vi.fn();

    const disposeFirstWill = service.registerWill(firstWill);
    service.registerWill(secondWill);
    disposeFirstWill();

    expect(state.runtime?.setWill).toHaveBeenLastCalledWith(secondWill);
  });

  it("keeps a later registration of the same Agent plugin factory live", async () => {
    const { service } = createService();
    const factory = vi.fn(async () => ({ name: "plugin" }));
    const disposeFirst = service.registerAgentPlugin(factory);
    service.registerAgentPlugin(factory);

    disposeFirst();
    const plugins = await Promise.all(
      state.runtime?.options
        .getAgentPluginFactories()
        .map((factory) => factory({} as Parameters<AgentPluginFactory>[0])) ?? [],
    );

    expect(plugins).toEqual([{ name: "plugin" }]);
  });
});
