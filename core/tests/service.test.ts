import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Session } from "koishi";

import { type RecordBase, type EventRecord } from "../src/messages.js";
import { DEFAULT_PERSONA } from "../src/runtime/prompt.js";

const state = vi.hoisted(() => ({
  runtime: undefined as
    | {
        reset: Mock;
        compact: Mock;
        archive: Mock;
        clear: Mock;
        status: Mock;
        list: Mock;
        stop: Mock;
        trigger: Mock;
        agent: unknown;
      }
    | undefined,
}));

type RegisteredCommand = {
  readonly name: string;
  readonly options: unknown;
  readonly action: Mock;
  readonly dispose: Mock;
  readonly subcommand: Mock;
  readonly option: Mock;
};

vi.mock("../src/runtime/manager.js", () => ({
  RuntimeManager: class {
    public reset = vi.fn(async () => undefined);
    public compact = vi.fn(async () => "");
    public archive = vi.fn(async () => "");
    public clear = vi.fn(async () => undefined);
    public status = vi.fn(async () => "");
    public list = vi.fn(async () => "");
    public stop = vi.fn(async () => undefined);
    public trigger = vi.fn(async () => undefined);

    constructor(
      _ctx: unknown,
      _model: unknown,
      _assets: unknown,
      _artifacts: unknown,
      _storage: unknown,
      _config: unknown,
      readonly agent: unknown,
    ) {
      state.runtime = this;
    }
  },
}));

import { ChannelPlugin, WillPlugin } from "../src/agents/index.js";
import type { Config } from "../src/config.js";
import { Gateway } from "../src/gateway/index.js";
import YesImBotService from "../src/index.js";

const config: Config = {
  basePath: "/tmp/yesimbot-service/data/yesimbot-service",
  chatModel: "mock:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  reply: {
    pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
    customInnerThought: false,
  },
};

const event: EventRecord<"delivery.failed"> = {
  eventType: "delivery.failed",
  platform: "test",
  selfId: "bot-1",
  timestamp: 2,
  channel: { id: "room-1", type: 0 },
  text: "Delivery failed",
  delivery: {
    turnId: "turn-1",
    messageId: "assistant-1",
    segmentIndex: 1,
    segmentTotal: 1,
    error: { name: "Error", message: "offline" },
  },
};

function createService(serviceConfig: Config = config) {
  const effectiveConfig = {
    ...serviceConfig,
    basePath: join(tmpdir(), `yesimbot-service-${randomUUID()}`),
  };
  const ctx = new Context();
  ctx.baseDir = "/tmp/yesimbot-service";
  Object.assign(ctx, { "yesimbot.model": {} });
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { database });
  vi.spyOn(ctx, "middleware").mockReturnValue(vi.fn() as never);
  vi.spyOn(ctx, "on").mockReturnValue(vi.fn() as never);
  const commands: RegisteredCommand[] = [];
  const createCommand = (name: string, options: unknown): RegisteredCommand => {
    const command = {
      name,
      options,
      action: vi.fn(),
      dispose: vi.fn(),
      subcommand: vi.fn((suffix: string) => {
        const child = createCommand(`${name}${suffix}`, undefined);
        commands.push(child);
        return child;
      }),
      option: vi.fn(() => command),
    };
    return command;
  };
  vi.spyOn(ctx, "command").mockImplementation((name, description, options) => {
    const command = createCommand(name, options ?? description);
    commands.push(command);
    return command as never;
  });
  const service = new YesImBotService(ctx as never, effectiveConfig);
  Object.assign(ctx, { yesimbot: service });
  return { ctx, service, database, commands, basePath: effectiveConfig.basePath };
}

describe("YesImBotService facade", () => {
  beforeEach(() => {
    state.runtime = undefined;
  });

  it("exposes only the confirmed facade", () => {
    const { ctx } = createService();

    expect(ctx.yesimbot.model).toBeDefined();
    expect(ctx.yesimbot.registerTranslator).toEqual(expect.any(Function));
    expect(ctx.yesimbot.agent).toBeDefined();
    expect(ctx.yesimbot.registerChannelPlugin).toBeUndefined();
    expect(ctx.yesimbot.registerWillConfigContributor).toBeUndefined();
    expect(ctx.yesimbot.registerWillEngineFactory).toBeUndefined();
    expect(ctx.yesimbot.getStoragePath).toEqual(expect.any(Function));
    expect(ctx.yesimbot.trigger).toEqual(expect.any(Function));
    expect("channelKey" in ctx.yesimbot).toBe(false);
    expect(["channel", "Identity"].join("") in ctx.yesimbot).toBe(false);
    expect(["register", "Storage"].join("") in ctx.yesimbot).toBe(false);
    expect(["ensure", "Storage"].join("") in ctx.yesimbot).toBe(false);
    expect("reload" in ctx.yesimbot).toBe(false);
    expect(ctx.yesimbot.reset).toEqual(expect.any(Function));
    expect(ctx.yesimbot.stop).toEqual(expect.any(Function));
    expect(ctx.yesimbot.assets).toBeDefined();
    expect("artifacts" in ctx.yesimbot).toBe(false);
    expect("runtime" in ctx.yesimbot).toBe(false);
    expect("gateway" in ctx.yesimbot).toBe(false);
    expect("platform" in ctx.yesimbot).toBe(false);
    expect("delivery" in ctx.yesimbot).toBe(false);
  });

  it("registers the authority-gated session admin command group", () => {
    const { commands } = createService();

    expect(commands.find((command) => command.name === "yesimbot.session")).toMatchObject({
      options: { authority: 4 },
    });
    expect(commands.map((command) => command.name)).toEqual(
      expect.arrayContaining([
        "yesimbot.session.compact",
        "yesimbot.session.archive",
        "yesimbot.session.clear",
        "yesimbot.session.status",
        "yesimbot.session.list",
      ]),
    );
  });

  it("passes configured channel allowlist rules to Gateway", () => {
    const allowedChannels = [{ platform: "test", channelId: "room-1", isDirect: false }];
    const { service } = createService({ ...config, allowedChannels });

    expect(service["gate"]["config"].allowedChannels).toEqual(allowedChannels);
  });

  it("accepts a class-based ChannelPlugin", () => {
    const plugin = new (class extends ChannelPlugin {
      public init() {
        return { name: "plugin" };
      }
    })();

    expect(plugin).toBeInstanceOf(ChannelPlugin);
  });

  it("triggers a forced event through the runtime and sends via the matching Bot", async () => {
    const { ctx, service } = createService();
    const wrongPlatform = {
      platform: "onebot",
      selfId: "bot-1",
      sendMessage: vi.fn(async () => []),
    };
    const wrongSelfId = { platform: "test", selfId: "bot-9", sendMessage: vi.fn(async () => []) };
    const exact = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(wrongPlatform as never, wrongSelfId as never, exact as never);
    state.runtime?.trigger.mockResolvedValue({
      kind: "run",
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
      })(),
      delivery: {
        signal: new AbortController().signal,
        onDelivered: vi.fn(),
        fail: vi.fn(),
      },
    });

    await service.trigger(event);

    expect(state.runtime?.trigger).toHaveBeenCalledWith(event);
    expect(exact.sendMessage).toHaveBeenCalledWith("room-1", [h.text("reply")]);
    expect(wrongPlatform.sendMessage).not.toHaveBeenCalled();
    expect(wrongSelfId.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a trigger with only decoy Bots before runtime admission", async () => {
    const { ctx, service } = createService();
    const wrongPlatform = {
      platform: "onebot",
      selfId: "bot-1",
      sendMessage: vi.fn(async () => []),
    };
    const wrongSelfId = { platform: "test", selfId: "bot-9", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(wrongPlatform as never, wrongSelfId as never);

    await expect(service.trigger(event)).rejects.toThrow("No Bot is available for test:bot-1");
    expect(state.runtime?.trigger).not.toHaveBeenCalled();
    expect(wrongPlatform.sendMessage).not.toHaveBeenCalled();
    expect(wrongSelfId.sendMessage).not.toHaveBeenCalled();
  });

  it("drains an admitted proactive trigger before global stop resolves", async () => {
    const { ctx, service } = createService();
    let sendStarted!: () => void;
    let sendRelease!: () => void;
    const sendBlocked = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const sendReleasePromise = new Promise<void>((resolve) => {
      sendRelease = resolve;
    });
    const sendMessage = vi.fn(async () => {
      sendStarted();
      await sendReleasePromise;
      return [];
    });
    ctx.bots.push({ platform: "test", selfId: "bot-1", sendMessage } as never);
    const onDelivered = vi.fn(async () => {
      expect(stopSettled).toBe(false);
    });
    state.runtime?.trigger.mockResolvedValue({
      kind: "run",
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
      })(),
      delivery: {
        signal: new AbortController().signal,
        onDelivered,
        fail: vi.fn(async () => undefined),
      },
    });

    let triggerSettled = false;
    const triggering = service.trigger(event).then(() => {
      triggerSettled = true;
    });
    await sendBlocked;
    let stopSettled = false;
    const stopping = service.stop().then(() => {
      stopSettled = true;
    });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(triggerSettled).toBe(false);
    expect(stopSettled).toBe(false);

    sendRelease();
    await stopping;
    await triggering;
    expect(triggerSettled).toBe(true);
    expect(stopSettled).toBe(true);
    expect(onDelivered).toHaveBeenCalledOnce();

    await expect(service.trigger(event)).resolves.toBeUndefined();
    expect(state.runtime?.trigger).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects a trigger with no matching Bot without runtime admission", async () => {
    const { service } = createService();

    await expect(service.trigger(event)).rejects.toThrow("No Bot is available for test:bot-1");
    expect(state.runtime?.trigger).not.toHaveBeenCalled();
  });

  it("delegates reset registration to the composed boundary", async () => {
    const { service } = createService();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", type: "shared" };

    await service.reset(scope);

    expect(state.runtime?.reset).toHaveBeenCalledWith(scope);
  });

  it("delegates shared reset assignee validation to RuntimeManager", async () => {
    const { service, database } = createService();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", type: "shared" };
    await service.reset(scope);

    expect(database.get).not.toHaveBeenCalled();
    expect(state.runtime?.reset).toHaveBeenCalledWith(scope);
  });

  it("exposes Core channel storage methods", async () => {
    const { service, basePath } = createService();
    const scope = { platform: "onebot", selfId: "10000", channelId: "123456", type: "shared" };

    await service.start();
    await expect(service.getStoragePath(scope)).resolves.toBe(join(basePath, "channels/shared-onebot-123456"));
  });

  it("creates the default PERSONA.md on first start without overwriting user files", async () => {
    const { service, basePath } = createService();
    const personaPath = join(basePath, "PERSONA.md");
    await rm(personaPath, { force: true });

    await service.start();

    await expect(readFile(personaPath, "utf8")).resolves.toBe(DEFAULT_PERSONA);
  });

  it("waits for storage readiness before resolving or routing a Session", async () => {
    const { ctx } = createService();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const translator = {
      platform: "test",
      translate: vi.fn(async (base: RecordBase, input: Session) => ({
        ...base,
        messageId: input.messageId,
        elements: input.elements ?? [],
      })),
    };
    const runtime = { route: vi.fn(async () => ({ kind: "wait", eventId: "event-1" })) };
    const assets = { createStore: vi.fn(() => ({ get: vi.fn(), put: vi.fn(), clear: vi.fn() })) };
    const gateway = new Gateway(
      ctx as never,
      {
        allowedChannels: [{ platform: "test", channelId: "room-1" }],
        pacing: config.reply.pacing,
        logLevel: config.logLevel,
      },
      { runtime: runtime as never, assets: assets as never, ready: () => ready },
    );
    gateway.registerTranslator(translator);
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
    expect(translator.translate).not.toHaveBeenCalled();
    expect(runtime.route).not.toHaveBeenCalled();
    expect(assets.createStore).not.toHaveBeenCalled();
    release();
    await handling;
    expect(translator.translate).toHaveBeenCalledOnce();
    expect(runtime.route).toHaveBeenCalledOnce();
  });

  it("registers and disposes class-based agent plugins", async () => {
    const { service } = createService();
    const first = { name: "first" };
    const second = { name: "second" };
    const disposeFirst = service.agent.use(
      new (class extends ChannelPlugin {
        public init() {
          return first;
        }
      })(),
    );
    service.agent.use(
      new (class extends ChannelPlugin {
        public init() {
          return second;
        }
      })(),
    );

    disposeFirst();
    await expect(
      service.agent.init({ platform: "test", selfId: "bot-1", channelId: "room", type: "shared" }, {} as never),
    ).resolves.toEqual([second]);
  });

  it("registers and disposes class-based Will plugins", async () => {
    const { service } = createService();
    const will = { decide: async () => "wait" as const };
    const plugin = new (class extends WillPlugin {
      public readonly priority = 1;

      public match(): boolean {
        return true;
      }

      public init() {
        return will;
      }
    })();

    const dispose = service.agent.will(plugin);
    await expect(
      service.agent.initWill({ platform: "test", selfId: "bot-1", channelId: "room", type: "shared" }, {} as never),
    ).resolves.toBe(will);
    dispose();
  });
});
