import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { createEntry, createJsonlStorage } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { Config as CoreConfig } from "../src/config.js";
import { createMessage, type EventRecord, type MessageRecord } from "../src/messages.js";
import { ChannelRuntime, type ChannelRuntimeOptions } from "../src/runtime/channel.js";
import { RuntimeManager, type ChannelPluginFactory } from "../src/runtime/manager.js";
import { scopeMapKey, ChannelStorage, type ChannelScope } from "../src/runtime/storage.js";
import {
  RoutingWillEngine,
  WillingnessWillEngine,
  type WillConfigContributor,
  type WillEngineFactory,
} from "../src/runtime/will.js";

function record(channelId: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: channelId, type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: `message-${channelId}`,
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function runtimeOptions(runtime: ChannelRuntime): ChannelRuntimeOptions {
  return (runtime as unknown as { readonly opts: ChannelRuntimeOptions }).opts;
}

const state = vi.hoisted(() => ({
  runtimes: [] as ChannelRuntime[],
  init: vi.fn(async () => undefined),
  handle: vi.fn(async () => ({ kind: "wait" as const, eventId: "event-1" })),
  trigger: vi.fn(async () => ({ kind: "join" as const, eventId: "event-1", turnId: "turn-1" })),
  stop: vi.fn(async () => undefined),
}));

function createManager(
  basePath = join(tmpdir(), `yesimbot-runtime-manager-${randomUUID()}`),
  will: CoreConfig["will"] = {
    engine: "routing",
    direct: "trigger",
    mention: "trigger",
    group: "wait",
  },
  extensions: {
    contributors?: readonly WillConfigContributor[];
    factories?: readonly WillEngineFactory[];
  } = {},
) {
  const ctx = new Context();
  const matchingBot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn() };
  const otherBot = { platform: "test", selfId: "other", sendMessage: vi.fn() };
  ctx.bots.push(matchingBot as never, otherBot as never);
  const modelInstance = { modelId: "test-model" };
  const resolveChatModel = vi.fn(() => ({ model: modelInstance, providerId: "test", entry: {} }));
  const modelService = { resolveChatModel } as never;
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { database });
  const storage = new ChannelStorage(ctx, { basePath });
  const assets = {
    clear: vi.fn(async () => undefined),
    createStore: vi.fn(() => ({ clear: assets.clear, get: vi.fn(), put: vi.fn() })),
  };
  const artifacts = {
    clear: vi.fn(async () => undefined),
    createStore: vi.fn(() => ({ clear: artifacts.clear, forTool: vi.fn(), open: vi.fn() })),
  };
  const channelPlugins = new Set<ChannelPluginFactory>();
  const config: CoreConfig = {
    basePath,
    chatModel: "test:model",
    visionModel: undefined,
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    will,
    reply: {
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      customInnerThought: false,
    },
    session: {
      compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
      idle: { timeout: 7_200_000 },
    },
  };
  return {
    manager: new RuntimeManager(
      ctx,
      modelService,
      assets as never,
      artifacts as never,
      storage,
      config,
      channelPlugins,
      new Set(extensions.contributors ?? []),
      new Set(extensions.factories ?? []),
      new Map(),
    ),
    assets,
    artifacts,
    ctx,
    resolveChatModel,
    matchingBot,
    otherBot,
    model: modelInstance,
    database,
    config,
    storage,
    channelPlugins,
  };
}

describe("RuntimeManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.runtimes = [];
    state.init.mockReset().mockResolvedValue(undefined);
    state.handle.mockReset().mockResolvedValue({ kind: "wait", eventId: "event-1" });
    state.trigger.mockReset().mockResolvedValue({ kind: "join", eventId: "event-1", turnId: "turn-1" });
    state.stop.mockReset().mockResolvedValue(undefined);
    vi.spyOn(ChannelRuntime.prototype, "init").mockImplementation(function () {
      state.runtimes.push(this);
      return state.init();
    });
    vi.spyOn(ChannelRuntime.prototype, "handle").mockImplementation(async () => state.handle());
    vi.spyOn(ChannelRuntime.prototype, "trigger").mockImplementation(async (record) => state.trigger(record));
    vi.spyOn(ChannelRuntime.prototype, "stop").mockImplementation(() => state.stop());
  });

  it("constructs one real runtime for concurrent first events with one canonical identity", async () => {
    const { manager } = createManager();

    await Promise.all([manager.route(record("room")), manager.route(record("room"))]);

    expect(state.runtimes).toHaveLength(1);
    expect(state.handle).toHaveBeenCalledTimes(2);
  });

  it("routes a forced event to the shared channel runtime without handling", async () => {
    const { manager } = createManager();
    const event = {
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room", type: 0 },
      text: "Delivery failed",
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    } satisfies EventRecord<"delivery.failed">;
    state.trigger.mockResolvedValue({ kind: "join", eventId: "event-1", turnId: "turn-1" });

    await expect(manager.trigger(event)).resolves.toMatchObject({ kind: "join", turnId: "turn-1" });

    expect(state.runtimes).toHaveLength(1);
    expect(state.trigger).toHaveBeenCalledWith(event);
    expect(state.handle).not.toHaveBeenCalled();
  });

  it("continues same-identity lifecycle work after a rejected creation", async () => {
    const { manager } = createManager();
    state.init.mockRejectedValueOnce(new Error("init failed"));

    await expect(manager.route(record("room"))).rejects.toThrow("init failed");
    await expect(manager.route(record("room"))).resolves.toMatchObject({ kind: "wait" });

    expect(state.runtimes).toHaveLength(2);
    expect(state.init).toHaveBeenCalledTimes(2);
  });

  it("does not block another canonical identity behind a pending lifecycle operation", async () => {
    const { manager } = createManager();
    const entered = deferred();
    const release = deferred();
    state.init.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });

    const first = manager.route(record("room-a"));
    await entered.promise;
    await expect(manager.route(record("room-b"))).resolves.toMatchObject({ kind: "wait" });
    release.resolve();
    await first;

    expect(state.runtimes).toHaveLength(2);
  });

  it("stops every cached runtime when one stop rejects", async () => {
    const { manager, assets } = createManager();
    await manager.route(record("room-a"));
    await manager.route(record("room-b"));
    state.stop.mockRejectedValueOnce(new Error("stop failed"));

    await manager.stop();

    expect(state.stop).toHaveBeenCalledTimes(2);
    expect(assets.clear).not.toHaveBeenCalled();
    await expect(manager.route(record("room-c"))).rejects.toThrow("Runtime manager is stopped");
  });

  it("uses exact platform and self id when constructing the runtime", async () => {
    const { manager, resolveChatModel } = createManager();

    await manager.route(record("room"));

    expect(state.runtimes).toHaveLength(1);
    expect(resolveChatModel).toHaveBeenCalledWith("test:model");
  });

  it("uses distinct runtime identities for distinct scope self IDs", () => {
    const shared = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      type: "shared",
    });
    const direct = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      type: "direct",
    });

    expect(scopeMapKey(shared("bot-a"))).not.toBe(scopeMapKey(shared("bot-b")));
    expect(scopeMapKey(direct("bot-a"))).not.toBe(scopeMapKey(direct("bot-b")));
  });

  it("does not handle an event before runtime initialization completes", async () => {
    const { manager } = createManager();
    const entered = deferred();
    const release = deferred();
    state.init.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    const routing = manager.route(record("room"));
    await entered.promise;

    expect(state.handle).not.toHaveBeenCalled();
    release.resolve();
    await routing;
    expect(state.handle).toHaveBeenCalledOnce();
  });

  it("uses routing or willingness from the supplied configuration", async () => {
    const routing = createManager();
    const willingness = createManager(undefined, {
      engine: "willingness",
      probabilityThreshold: 55,
      decayHalfLifeSeconds: 600,
      replyCost: 35,
    });

    await routing.manager.route(record("routing"));
    await willingness.manager.route(record("willingness"));

    expect(runtimeOptions(state.runtimes[0]!).will).toBeInstanceOf(RoutingWillEngine);
    expect(runtimeOptions(state.runtimes[1]!).will).toBeInstanceOf(WillingnessWillEngine);
  });

  it("applies registered will config contributors when creating a runtime", async () => {
    const contributor: WillConfigContributor = {
      contribute: async () => ({ group: "trigger" as const }),
    };
    const { manager } = createManager(undefined, undefined, { contributors: [contributor] });

    await manager.route(record("room"));
    const will = runtimeOptions(state.runtimes[0]!).will as RoutingWillEngine;

    await expect(will.decide(createMessage(record("room")), { activeTurnId: null })).resolves.toBe("trigger");
  });

  it("uses a registered will engine factory when creating a runtime", async () => {
    const factory: WillEngineFactory = {
      create: async () => ({
        decide: async () => "wait" as const,
      }),
    };
    const { manager } = createManager(undefined, undefined, { factories: [factory] });

    const result = await manager.route(record("room"));

    expect(result.kind).toBe("wait");
    expect(runtimeOptions(state.runtimes[0]!).will).toMatchObject({ decide: expect.any(Function) });
  });

  it("stops an unpublished runtime when initialization fails", async () => {
    const { manager } = createManager();
    state.init.mockRejectedValueOnce(new Error("init failed"));

    await expect(manager.route(record("room"))).rejects.toThrow("init failed");
    expect(state.stop).toHaveBeenCalledOnce();
    expect(state.handle).not.toHaveBeenCalled();
  });

  it("does not repeat assignee admission for an admitted shared record", async () => {
    const { manager, database } = createManager();
    await manager.route(record("room"));

    expect(database.get).not.toHaveBeenCalled();
  });

  it("keeps shared runtimes distinct when selfId changes", async () => {
    const { manager } = createManager();
    await manager.route(record("room"));
    const first = state.runtimes[0];

    await manager.route(record("room", { selfId: "other" }));

    expect(first?.stop).not.toHaveBeenCalled();
    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[1]?.selfId).toBe("other");
  });

  it("keeps different canonical identities isolated", async () => {
    const { manager } = createManager();
    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(state.runtimes).toHaveLength(2);
  });

  it("snapshots the resolved model and agent plugins per runtime", async () => {
    const { manager, model, channelPlugins } = createManager();
    const first = { name: "first" };
    const second = { name: "second" };
    channelPlugins.add(async () => first);
    const result = await manager.route(record("room-a"));
    expect(runtimeOptions(state.runtimes[0]!)).toMatchObject({ model });
    expect(runtimeOptions(state.runtimes[0]!).agentPlugins).toContain(first);
    channelPlugins.clear();
    channelPlugins.add(async () => second);
    state.handle.mockResolvedValueOnce({ kind: "join" as const, eventId: "event-2", turnId: "turn-2" });

    await manager.route(record("room-b"));

    expect(runtimeOptions(state.runtimes[1]!)).toMatchObject({ model });
    expect(runtimeOptions(state.runtimes[1]!).agentPlugins).toContain(second);
  });

  it("snapshots configured image budgets for each new runtime", async () => {
    const { manager, config } = createManager();

    await manager.route(record("room"));
    expect(runtimeOptions(state.runtimes[0]!).imageBudget).toBeNull();

    config.imageInput = { maxCount: 2, maxBytesPerImage: 1024, maxTotalBytes: 2048 };
    await manager.route(record("room", { selfId: "other" }));

    expect(runtimeOptions(state.runtimes[1]!).imageBudget).toEqual({
      maxCount: 2,
      maxBytesPerImage: 1024,
      maxTotalBytes: 2048,
    });
  });

  it("resolves a configured vision model that declares image input", async () => {
    const { manager, config, model, resolveChatModel } = createManager();
    config.visionModel = "vision:model";
    resolveChatModel.mockReturnValue({ model, providerId: "vision", entry: { modalities: { input: ["image"] } } });

    await manager.route(record("room"));

    expect(runtimeOptions(state.runtimes[0]!).visionModel).toBe(model);
  });

  it("skips the vision model when it lacks image input", async () => {
    const { manager, config, model, resolveChatModel } = createManager();
    config.visionModel = "vision:model";
    resolveChatModel.mockReturnValue({ model, providerId: "vision", entry: { modalities: { input: ["text"] } } });

    await manager.route(record("room"));

    expect(runtimeOptions(state.runtimes[0]!).visionModel).toBeUndefined();
  });

  it("skips the vision model when none is configured or resolution fails", async () => {
    const { manager, config, resolveChatModel, model } = createManager();
    await manager.route(record("room"));
    expect(runtimeOptions(state.runtimes[0]!).visionModel).toBeUndefined();

    config.visionModel = "vision:broken";
    resolveChatModel.mockImplementation((id: string) => {
      if (id === "vision:broken") throw new Error("unknown model");
      return { model, providerId: "test", entry: {} };
    });
    await manager.route(record("room", { selfId: "other" }));
    expect(runtimeOptions(state.runtimes[1]!).visionModel).toBeUndefined();
  });

  it("injects configured idle compaction with the main model fallback", async () => {
    const { manager, config, model, resolveChatModel } = createManager();
    Object.assign(config, {
      session: {
        compact: {
          threshold: 0.75,
          charTokenRatio: 2,
          minMessages: 3,
          maxFailures: 2,
          model: undefined,
        },
        idle: { timeout: 1_234 },
      },
    });

    await manager.route(record("room"));

    const options = runtimeOptions(state.runtimes[0]!);
    expect(options).toMatchObject({ idleTimeout: 1_234, model });
    expect(options.compact).toEqual(expect.any(Function));
    expect(options.agentPlugins.some((plugin) => plugin.name === "yesimbot-compact")).toBe(true);
    expect(resolveChatModel).toHaveBeenCalledOnce();
  });

  it("passes no formatter capability option to new runtimes", async () => {
    const { manager } = createManager();

    await manager.route(record("room"));

    expect(runtimeOptions(state.runtimes[0]!)).not.toHaveProperty("includeMessageId");
  });

  it("injects channel-first JSONL storage", async () => {
    const { manager } = createManager();
    await manager.route(record("room"));

    expect(runtimeOptions(state.runtimes[0]!).storage).toEqual(
      expect.objectContaining({ append: expect.any(Function) }),
    );
  });

  it("stops clears and recreates a cached runtime on reset", async () => {
    const { manager, assets } = createManager();
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    await manager.route(record("room"));
    await manager.reset(scope);
    await manager.route(record("room"));

    expect(state.stop).toHaveBeenCalledOnce();
    expect(assets.createStore).toHaveBeenCalledWith(scope);
    expect(assets.clear).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("evicts a runtime when reset cleanup fails", async () => {
    const { manager, storage, assets } = createManager();
    await manager.route(record("room"));
    vi.spyOn(storage, "getStoragePath").mockRejectedValueOnce(new Error("storage clear failed"));

    await expect(
      manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", type: "shared" }),
    ).rejects.toThrow("storage clear failed");
    await manager.route(record("room"));
    expect(assets.clear).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("clears uncached sessions and assets without creating a runtime", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { ctx, manager, assets } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "uncached",
      type: "shared",
    } satisfies ChannelScope;
    const path = join(await new ChannelStorage(ctx, { basePath }).getStoragePath(scope), "sessions", "messages.jsonl");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "stored\n");

    await manager.reset(scope);
    expect(state.runtimes).toHaveLength(0);
    expect(assets.createStore).toHaveBeenCalledWith(scope);
    expect(assets.clear).toHaveBeenCalledWith();
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the manifest and plugin files when resetting", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets, storage } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const root = await storage.getStoragePath(scope);
    const messages = join(root, "sessions", "messages.jsonl");
    const asset = join(root, "assets", "asset");
    const workspace = join(root, "workspace", "keep.txt");
    await Promise.all([
      mkdir(join(root, "sessions"), { recursive: true }),
      mkdir(join(root, "assets"), { recursive: true }),
      mkdir(join(root, "workspace"), { recursive: true }),
    ]);
    await Promise.all([writeFile(messages, "stored"), writeFile(asset, "asset"), writeFile(workspace, "keep")]);
    assets.createStore.mockImplementation((target) => ({
      get: vi.fn(),
      put: vi.fn(),
      clear: async () => rm(join(await storage.getStoragePath(target), "assets"), { recursive: true, force: true }),
    }));

    await manager.reset(scope);
    await expect(access(messages)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(asset)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(workspace)).resolves.toBeUndefined();
    await expect(access(join(await storage.getStoragePath(scope), "channel.json"))).resolves.toBeUndefined();
  });

  it("rejects reset after stop without clearing persisted data", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { ctx, manager, assets } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const sessionsDir = join(await new ChannelStorage(ctx, { basePath }).getStoragePath(scope), "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sessionPath = join(sessionsDir, "20260803T143022Z.jsonl");
    await writeFile(sessionPath, "persisted");
    await manager.route(record("room"));
    await manager.stop();

    await expect(manager.reset(scope)).rejects.toThrow("Runtime manager is stopped");
    await expect(access(sessionPath)).resolves.toBeUndefined();
    expect(assets.clear).not.toHaveBeenCalled();
  });

  it("archives an active session without a summary and replaces its runtime", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, storage } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const sessionsDir = join(await storage.getStoragePath(scope), "sessions");
    const active = join(sessionsDir, "20260803T143022Z.jsonl");
    await mkdir(sessionsDir, { recursive: true });
    await createJsonlStorage(active).append(
      createEntry("message", { role: "user", id: "message-1", timestamp: 1, content: "hello" }),
    );

    await expect(manager.archive(scope, { noSummary: true })).resolves.toBe("已归档当前会话。");

    expect(state.runtimes).toHaveLength(2);
    expect(state.stop).toHaveBeenCalledOnce();
    expect(await readdir(sessionsDir)).toHaveLength(2);
    await expect(access(active)).resolves.toBeUndefined();
  });
  it("restores a usable runtime when summary archival fails", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, storage } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const sessionsDir = join(await storage.getStoragePath(scope), "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await createJsonlStorage(join(sessionsDir, "20260803T143022Z.jsonl")).append(
      createEntry("message", { role: "user", id: "message-1", timestamp: 1, content: "hello" }),
    );
    await manager.route(record("room"));

    await expect(manager.archive(scope)).rejects.toThrow();
    expect(state.runtimes).toHaveLength(2);
    await expect(manager.route(record("room", { messageId: "after-failure" }))).resolves.toMatchObject({
      kind: "wait",
    });
  });

  it("reports and lists persisted session metadata without creating a runtime", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, storage } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const sessionsDir = join(await storage.getStoragePath(scope), "sessions");
    const filename = "20260803T143022Z.jsonl";
    await mkdir(sessionsDir, { recursive: true });
    await createJsonlStorage(join(sessionsDir, filename)).append(
      createEntry("message", { role: "user", id: "message-1", timestamp: 1, content: "hello" }),
      createEntry("compact", { summary: "memory", lastEntryId: "entry-1" }),
      createEntry("message", { role: "assistant", id: "message-2", timestamp: 2, content: "hi" }),
    );

    await expect(manager.status(scope)).resolves.toContain(`活动会话：${filename}`);
    await expect(manager.status(scope)).resolves.toContain("消息：2");
    await expect(manager.status(scope)).resolves.toContain("压缩：1");
    await expect(manager.status(scope)).resolves.toContain("自上次压缩以来消息：1");
    await expect(manager.list(scope)).resolves.toContain(`→ ${filename} (${filename.replace(".jsonl", "")}, 2 条`);
    expect(state.runtimes).toHaveLength(0);
  });

  it("clears sessions and assets through the named admin operation", async () => {
    const { manager, assets } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", type: "shared" } satisfies ChannelScope;

    await manager.clear(scope);

    expect(assets.clear).toHaveBeenCalledOnce();
  });

  it("keeps direct channels isolated by self id without assignee lookup", async () => {
    const { manager, database } = createManager();
    database.get.mockRejectedValue(new Error("direct channels do not query assignees"));
    await manager.route(record("room", { selfId: "bot-1", channel: { id: "room", type: 1 } }));
    await manager.route(record("room", { selfId: "other", channel: { id: "room", type: 1 } }));

    expect(state.runtimes).toHaveLength(2);
    expect(database.get).not.toHaveBeenCalled();
  });
});
