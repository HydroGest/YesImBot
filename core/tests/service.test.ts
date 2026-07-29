import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  runtime: undefined as
    | {
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

vi.mock("../src/runtime/index.js", () => ({
  assertAssignee: vi.fn(async () => undefined),
  RuntimeManager: class {
    reset = vi.fn(async () => undefined);
    stop = vi.fn(async () => undefined);

    constructor(readonly options: { getAgentPluginFactories(): readonly AgentPluginFactory[] }) {
      state.runtime = this;
    }
  },
}));

import type { Config } from "../src/config.js";
import { Gateway } from "../src/gateway.js";
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
    expect(ctx.yesimbot.registerAgentPlugin).toEqual(expect.any(Function));
    expect(ctx.yesimbot.getStoragePath).toEqual(expect.any(Function));
    expect("channelKey" in ctx.yesimbot).toBe(false);
    expect(["channel", "Identity"].join("") in ctx.yesimbot).toBe(false);
    expect(["register", "Storage"].join("") in ctx.yesimbot).toBe(false);
    expect(["ensure", "Storage"].join("") in ctx.yesimbot).toBe(false);
    expect("reload" in ctx.yesimbot).toBe(false);
    expect(ctx.yesimbot.reset).toEqual(expect.any(Function));
    expect(ctx.yesimbot.stop).toEqual(expect.any(Function));
    expect(ctx.yesimbot.assets).toBeDefined();
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

  it("accepts the public AgentPluginFactory parameters", () => {
    const factory: AgentPluginFactory = async (scope, bot) => ({
      name: `plugin-${scope.platform}`,
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

  it("registers the authority-4 modality command without replacing active runtimes", async () => {
    const addChatModelInputModality = vi.fn(async () => "added" as const);
    const { commands } = createService(config, { addChatModelInputModality });
    const command = commands.find(({ name }) =>
      name.startsWith("yesimbot.model.add-input-modality"),
    );

    expect(command?.options).toEqual({ authority: 4 });
    const action = command?.action.mock.calls[0]?.[0];
    await expect(action({}, "vision", "image")).resolves.toContain(
      "Active runtimes keep their snapshot until replacement.",
    );
    expect(addChatModelInputModality).toHaveBeenCalledWith("vision", "image");
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

  it("delegates shared reset assignee validation to RuntimeManager", async () => {
    const { service, database } = createService();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };
    await service.reset(scope);

    expect(database.get).not.toHaveBeenCalled();
    expect(state.runtime?.reset).toHaveBeenCalledWith(scope);
  });

  it("exposes Core channel storage methods", async () => {
    const { service } = createService();
    const scope = { platform: "onebot", selfId: "10000", channelId: "123456", isDirect: false };

    await service.start();
    await expect(service.getStoragePath(scope)).resolves.toBe(
      "/tmp/yesimbot-service/data/yesimbot-service/channels/shared-onebot-123456",
    );
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
        kind: "message" as const,
        messageId: "message-1",
        elements: [],
        text: "hello",
      })),
    };
    const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
    const assets = { createStore: vi.fn(() => ({ get: vi.fn(), put: vi.fn(), clear: vi.fn() })) };
    const gateway = new Gateway({
      ctx: ctx as never,
      runtime: runtime as never,
      assets: assets as never,
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
      messageId: "message-1",
      isDirect: false,
      content: "hello",
      elements: [],
      event: {},
      send: vi.fn(),
    } as never);

    await Promise.resolve();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    release();
    await handling;
    expect(resolver.resolve).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledOnce();
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
         .map((factory) => factory({} as Parameters<AgentPluginFactory>[0], {} as never)) ?? [],
    );

    expect(plugins).toEqual([{ name: "plugin" }]);
  });
});
