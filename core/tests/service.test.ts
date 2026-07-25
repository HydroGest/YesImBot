import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  runtime: undefined as
    | {
        setWill: ReturnType<typeof vi.fn>;
        reload: ReturnType<typeof vi.fn>;
        reset: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        options: { getAgentPluginFactories(): readonly AgentPluginFactory[] };
      }
    | undefined,
}));

type RegisteredCommand = {
  readonly name: string;
  readonly options: unknown;
  readonly action: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
};

vi.mock("../src/runtime/manager.js", () => ({
  RuntimeManager: class {
    setWill = vi.fn();
    reload = vi.fn(async () => undefined);
    reset = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);

    constructor(readonly options: { getAgentPluginFactories(): readonly AgentPluginFactory[] }) {
      state.runtime = this;
    }
  },
}));

import type { Config } from "../src/config.js";
import { Gateway } from "../src/gateway/index.js";
import type { AgentPluginFactory } from "../src/index.js";
import { YesImBotService } from "../src/service.js";

const config: Config = { basePath: "data/yesimbot-service", chatModel: "mock:model" };

function createService(
  serviceConfig: Config = config,
  model: { addChatModelInputModality?: ReturnType<typeof vi.fn> } = {},
) {
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-service";
  Object.assign(ctx, { "yesimbot.model": model });
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { database });
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
  const commands: RegisteredCommand[] = [];
  vi.spyOn(ctx, "command").mockImplementation((name, description, options) => {
    const command = { name, options: options ?? description, action: vi.fn(), dispose: vi.fn() };
    commands.push(command);
    return command as never;
  });
  const service = new YesImBotService(ctx as never, serviceConfig);
  Object.assign(ctx, { yesimbot: service });
  return { ctx, service, database, commands };
}

describe("YesImBotService facade", () => {
  beforeEach(() => {
    state.runtime = undefined;
  });

  it("exposes only the confirmed facade", () => {
    const { ctx } = createService();

    expect(ctx.yesimbot.model).toBeDefined();
    expect(ctx.yesimbot.registerResolver).toEqual(expect.any(Function));
    expect(ctx.yesimbot.registerWill).toEqual(expect.any(Function));
    expect(ctx.yesimbot.registerAgentPlugin).toEqual(expect.any(Function));
    expect(ctx.yesimbot.channelKey).toEqual(expect.any(Function));
    expect(ctx.yesimbot.registerStorage).toEqual(expect.any(Function));
    expect(ctx.yesimbot.ensureStorage).toEqual(expect.any(Function));
    expect(ctx.yesimbot.listChannels).toEqual(expect.any(Function));
    expect(ctx.yesimbot.reload).toEqual(expect.any(Function));
    expect(ctx.yesimbot.reset).toEqual(expect.any(Function));
    expect(ctx.yesimbot.stop).toEqual(expect.any(Function));
    expect("assets" in ctx.yesimbot).toBe(false);
    expect("runtime" in ctx.yesimbot).toBe(false);
    expect("gateway" in ctx.yesimbot).toBe(false);
    expect("platform" in ctx.yesimbot).toBe(false);
    expect("delivery" in ctx.yesimbot).toBe(false);
  });

  it("passes configured channel allowlist rules to Gateway", () => {
    const allowedChannels = [{ platform: "test", channelId: "room-1", isDirect: false }];
    const { service } = createService({ ...config, allowedChannels });

    expect(service["gate"]["opts"].allowedChannels).toEqual(allowedChannels);
  });

  it("accepts the public AgentPluginFactory context", () => {
    const factory: AgentPluginFactory = async ({ channel, bot }) => ({
      name: `plugin-${channel.platform}`,
      tools: bot ? [] : [],
    });

    expect(factory).toBeTypeOf("function");
  });

  it("delegates reset registration to the composed boundary", async () => {
    const { service } = createService();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };

    await service.reset(scope);

    expect(state.runtime?.reset).toHaveBeenCalledWith(scope);
  });

  it("delegates reload through the composed boundary", async () => {
    const { service } = createService();
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      isDirect: false,
    };

    await service.reload(scope);

    expect(state.runtime?.reload).toHaveBeenCalledWith(scope);
  });

  it("registers the authority-4 modality command without replacing active runtimes", async () => {
    const addChatModelInputModality = vi.fn(async () => "added" as const);
    const { commands } = createService(config, { addChatModelInputModality });
    const command = commands.find(({ name }) =>
      name.startsWith("yesimbot.model.add-input-modality"),
    );

    expect(command?.options).toEqual({ authority: 4 });
    const action = command?.action.mock.calls[0]?.[0];
    await expect(action({}, "vision", "image")).resolves.toContain("added");
    expect(addChatModelInputModality).toHaveBeenCalledWith("vision", "image");
    expect(state.runtime?.reload).not.toHaveBeenCalled();
  });

  it("reports an idempotent modality command no-op and invalid command error", async () => {
    const addChatModelInputModality = vi
      .fn()
      .mockResolvedValueOnce("unchanged")
      .mockRejectedValueOnce(new Error("invalid modality"));
    const { commands } = createService(config, { addChatModelInputModality });
    const command = commands.find(({ name }) =>
      name.startsWith("yesimbot.model.add-input-modality"),
    );
    const action = command?.action.mock.calls[0]?.[0];

    await expect(action({}, "vision", "image")).resolves.toContain("unchanged");
    await expect(action({}, "vision", "unknown")).resolves.toContain("invalid modality");
  });

  it("rejects shared reload before RuntimeManager for a non-assignee", async () => {
    const { service, database } = createService();
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      isDirect: false,
    };
    database.get.mockResolvedValue([{ assignee: "other" }]);

    await expect(service.reload(scope)).rejects.toMatchObject({ reason: "mismatch" });
    expect(state.runtime?.reload).not.toHaveBeenCalled();
  });

  it("rejects shared resets before the Runtime manager for a non-assignee", async () => {
    const { service, database } = createService();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };
    database.get.mockResolvedValue([{ assignee: "other" }]);

    await expect(service.reset(scope)).rejects.toMatchObject({ reason: "mismatch" });

    expect(state.runtime?.reset).not.toHaveBeenCalled();
  });

  it("exposes Core channel storage methods", async () => {
    const { service } = createService();
    const scope = { platform: "onebot", selfId: "10000", channelId: "123456", isDirect: false };

    await service.start();
    const dispose = service.registerStorage("workspace");
    expect(service.channelKey(scope)).toBe("a5vnf2ijd75c2ibyo2s5czdir4");
    await expect(service.ensureStorage(scope, "workspace")).resolves.toContain(
      "channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace",
    );
    expect(service.listChannels()).toEqual([
      expect.objectContaining({ key: "a5vnf2ijd75c2ibyo2s5czdir4", selfId: null }),
    ]);
    dispose();
  });

  it("waits for storage readiness before resolving or routing a Session", async () => {
    const { ctx } = createService();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = {
      platform: "test",
      resolve: vi.fn(async () => ({
        type: "message",
        platform: "test",
        selfId: "bot-1",
        timestamp: 1,
        channel: { id: "room-1", type: 0 },
        user: { id: "user-1" },
        message: { id: "message-1", content: "hello" },
        content: "hello",
      })),
    };
    const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
    const assets = { readByAssetId: vi.fn(), clear: vi.fn() };
    const gateway = new Gateway({
      ctx: ctx as never,
      runtime: runtime as never,
      assets: assets as never,
      storage: { updateName: vi.fn() } as never,
      ready: () => ready,
      allowedChannels: [{ platform: "test", channelId: "room-1" }],
      logger: { warn: vi.fn() } as never,
    });
    gateway.register(resolver);
    const handling = gateway.handle({
      type: "message-created",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      isDirect: false,
      content: "hello",
      elements: [],
      event: {},
      send: vi.fn(),
    } as never);

    await Promise.resolve();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
    expect(assets.readByAssetId).not.toHaveBeenCalled();
    release();
    await handling;
    expect(resolver.resolve).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("clears the custom Will override after the final identity-safe disposal", () => {
    const { service } = createService();
    const firstWill = vi.fn();
    const secondWill = vi.fn();

    const disposeFirstWill = service.registerWill(firstWill);
    const disposeSecondWill = service.registerWill(secondWill);
    disposeSecondWill();
    expect(state.runtime?.setWill).toHaveBeenLastCalledWith(firstWill);
    disposeFirstWill();
    expect(state.runtime?.setWill).toHaveBeenLastCalledWith(undefined);
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
