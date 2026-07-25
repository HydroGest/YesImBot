import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  runtimes: [] as Array<{
    readonly options: Record<string, unknown>;
    init: ReturnType<typeof vi.fn>;
    handle: ReturnType<typeof vi.fn>;
    handleInternal: ReturnType<typeof vi.fn>;
    acquireDeliveryLease: ReturnType<typeof vi.fn>;
    beginDrain: ReturnType<typeof vi.fn>;
    drainAndStop: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  nextInit: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../src/runtime/channel.js", () => ({
  ChannelRuntimeDrainingError: class ChannelRuntimeDrainingError extends Error {
    constructor() {
      super("Channel runtime is draining");
      this.name = "ChannelRuntimeDrainingError";
    }
  },
  ChannelRuntime: class {
    readonly init = vi.fn(async () => {
      const next = state.nextInit;
      state.nextInit = undefined;
      await next?.();
    });
    readonly handle = vi.fn(async () => ({ kind: "wait", eventId: "event-1" }));
    readonly handleInternal = vi.fn(async () => ({ kind: "wait", eventId: "event-1" }));
    readonly acquireDeliveryLease = vi.fn(() => vi.fn());
    readonly beginDrain = vi.fn();
    readonly drainAndStop = vi.fn(async () => undefined);
    readonly reset = vi.fn(async () => undefined);
    readonly stop = vi.fn(async () => undefined);

    constructor(readonly options: Record<string, unknown>) {
      state.runtimes.push(this);
    }
  },
}));

import { channelIdentity, type ChannelScope } from "../src/channel/index.js";
import type { Config } from "../src/config.js";
import type { EventRecord, MessageRecord } from "../src/event/index.js";
import { ChannelRuntimeDrainingError } from "../src/runtime/channel.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import { ChannelStorage } from "../src/storage/index.js";
import { DefaultWill, type Will, WillingnessWill } from "../src/will/index.js";

function record(
  channelId: string,
  overrides: Partial<MessageRecord> = {},
): MessageRecord {
  return {
    schemaVersion: 1,
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: channelId, type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: `message-${channelId}`,
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    text: "hello",
    ...overrides,
  };
}

function createManager(basePath = "/tmp/yesimbot-runtime-manager", will?: Config["will"]) {
  const ctx = new Context();
  const matchingBot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn() };
  const otherBot = { platform: "test", selfId: "other", sendMessage: vi.fn() };
  ctx.bots.push(otherBot as never, matchingBot as never);
  const model = { modelId: "test-model", modalities: { input: ["image"] } };
  let entry: { readonly modalities?: { readonly input?: readonly string[] } } = {};
  const resolveChatModel = vi.fn(() => ({ model, entry }));
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { "yesimbot.model": { resolveChatModel }, database });
  const assets = { clear: vi.fn(async () => undefined), readByAssetId: vi.fn() };
  const getAgentPluginFactories = vi.fn(() => []);
  const storage = new ChannelStorage(basePath);
  const config: Config = { basePath, chatModel: "test:model", will };
  const manager = new RuntimeManager({
    ctx,
    config,
    logger: { warn: vi.fn() } as never,
    assets: assets as never,
    storage,
    getAgentPluginFactories,
  });
  return {
    manager,
    matchingBot,
    otherBot,
    model,
    setEntry: (next: typeof entry) => {
      entry = next;
    },
    config,
    resolveChatModel,
    assets,
    database,
    getAgentPluginFactories,
    storage,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("RuntimeManager", () => {
  beforeEach(() => {
    state.runtimes = [];
    state.nextInit = undefined;
  });

  it("uses one identity for shared scopes and distinct identities for direct scopes", () => {
    const sharedScope = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      isDirect: false,
    });
    const directScope = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      isDirect: true,
    });

    expect(channelIdentity(sharedScope("bot-a"))).toBe(channelIdentity(sharedScope("bot-b")));
    expect(channelIdentity(directScope("bot-a"))).not.toBe(channelIdentity(directScope("bot-b")));
  });

  it("initializes a runtime before publishing it", async () => {
    const { manager } = createManager();
    const entered = deferred<void>();
    const release = deferred<void>();
    state.nextInit = async () => {
      entered.resolve();
      await release.promise;
    };

    const routing = manager.route(record("room"));
    await entered.promise;
    expect(state.runtimes[0]?.handle).not.toHaveBeenCalled();

    release.resolve();
    await routing;
    expect(state.runtimes[0]?.init).toHaveBeenCalledOnce();
    expect(state.runtimes[0]?.handle).toHaveBeenCalledOnce();
  });

  it("uses routing by default and willingness only when explicitly selected", async () => {
    const routing = createManager();
    const willingness = createManager("/tmp/yesimbot-willingness", {
      engine: "willingness",
      base: { text: 12 },
    });

    await routing.manager.route(record("routing"));
    await willingness.manager.route(record("willingness"));

    expect(state.runtimes[0]?.options.will).toBeInstanceOf(DefaultWill);
    expect(state.runtimes[1]?.options.will).toBeInstanceOf(WillingnessWill);
  });

  it("keeps a custom Will factory authoritative over willingness configuration", async () => {
    const { manager } = createManager("/tmp/yesimbot-custom-will", { engine: "willingness" });
    const custom = { decide: async () => "wait" as const } satisfies Will;
    manager.setWill(() => custom);

    await manager.route(record("room"));

    expect(state.runtimes[0]?.options.will).toBe(custom);
  });

  it("restores configured willingness after clearing a custom Will override", async () => {
    const { manager } = createManager("/tmp/yesimbot-clear-will", { engine: "willingness" });
    const custom = { decide: async () => "wait" as const } satisfies Will;
    manager.setWill(() => custom);

    await manager.route(record("room"));
    manager.setWill();
    await manager.route(record("room"));

    expect(state.runtimes[0]?.options.will).toBe(custom);
    expect(state.runtimes[1]?.options.will).toBeInstanceOf(WillingnessWill);
  });

  it("stops an unpublished runtime when initialization fails", async () => {
    const { manager } = createManager();
    state.nextInit = async () => {
      throw new Error("init failed");
    };

    await expect(manager.route(record("room"))).rejects.toThrow("init failed");

    expect(state.runtimes).toHaveLength(1);
    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
    expect(state.runtimes[0]?.handle).not.toHaveBeenCalled();
  });

  it("creates one runtime for concurrent first events with the same canonical identity", async () => {
    const { manager } = createManager();

    await Promise.all([
      manager.route(record("room", { guild: { id: "guild-a" } })),
      manager.route(record("room", { guild: { id: "guild-b" } })),
    ]);

    expect(state.runtimes).toHaveLength(1);
    expect(state.runtimes[0]?.handle).toHaveBeenCalledTimes(2);
  });

  it("revalidates shared assignment inside the lifecycle before creating a runtime", async () => {
    const { manager, database, resolveChatModel } = createManager();
    database.get.mockResolvedValue([{ assignee: "other" }]);

    await expect(manager.route(record("room"))).rejects.toMatchObject({ reason: "mismatch" });

    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(state.runtimes).toHaveLength(0);
  });

  it("keeps different canonical channel identities isolated", async () => {
    const { manager } = createManager();

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(state.runtimes).toHaveLength(2);
  });

  it("injects only the bot with the exact platform and self id", async () => {
    const { manager, matchingBot, otherBot } = createManager();

    await manager.route(record("room"));

    expect(state.runtimes[0]?.options.bot).toBe(matchingBot);
    expect(state.runtimes[0]?.options.bot).not.toBe(otherBot);
  });

  it("snapshots the model, agent plugins, and Will factory when creating a runtime", async () => {
    const { manager, model, resolveChatModel, getAgentPluginFactories } = createManager();
    const firstWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const secondWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const firstPlugin = { name: "first" };
    const secondPlugin = { name: "second" };
    const firstFactory = vi.fn(async () => firstWill);
    const secondFactory = vi.fn(async () => secondWill);
    getAgentPluginFactories
      .mockReturnValueOnce([async () => firstPlugin])
      .mockReturnValue([async () => secondPlugin]);
    manager.setWill(firstFactory);

    await manager.route(record("room-a"));
    manager.setWill(secondFactory);
    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(resolveChatModel).toHaveBeenCalledWith("test:model");
    expect(firstFactory).toHaveBeenCalledOnce();
    expect(secondFactory).toHaveBeenCalledTimes(2);
    expect(state.runtimes[0]?.options).toMatchObject({ model, will: firstWill });
    expect(state.runtimes[0]?.options.agentPlugins).toEqual([firstPlugin]);
    expect(state.runtimes[1]?.options).toMatchObject({ model, will: secondWill });
    expect(state.runtimes[2]?.options).toMatchObject({ model, will: secondWill });
  });

  it("snapshots resolved model media capability and policy until non-destructive reload", async () => {
    const { manager, config, setEntry, assets } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false };

    await manager.route(record("room"));
    const first = state.runtimes[0]?.options;

    expect(first?.imageInput).toBe(false);
    expect(first?.mediaPolicy).toEqual({
      enabled: true,
      maxImages: 4,
      maxImageBytes: 5 * 1024 * 1024,
      maxTotalImageBytes: 10 * 1024 * 1024,
      strategy: "current-first",
    });
    expect(Object.isFrozen(first?.mediaPolicy)).toBe(true);
    expect(first?.will).toBeInstanceOf(DefaultWill);
    expect(first).not.toHaveProperty("session");

    setEntry({ modalities: { input: ["image"] } });
    config.multimedia = {
      enabled: false,
      image: {
        selection: "fifo",
        maxCountPerCall: 2,
        maxBytesPerImage: 1024,
        maxBytesPerCall: 2048,
      },
    };
    config.will = { engine: "willingness", base: { text: 12 } };

    await manager.route(record("room"));
    expect(state.runtimes).toHaveLength(1);
    expect(first?.imageInput).toBe(false);
    expect(first?.mediaPolicy).toMatchObject({ enabled: true, strategy: "current-first" });

    await manager.reload(scope);
    await manager.route(record("room"));
    const replacement = state.runtimes[1]?.options;

    expect(replacement?.imageInput).toBe(true);
    expect(replacement?.mediaPolicy).toEqual({
      enabled: false,
      maxImages: 2,
      maxImageBytes: 1024,
      maxTotalImageBytes: 2048,
      strategy: "fifo",
    });
    expect(replacement?.will).toBeInstanceOf(WillingnessWill);
    expect(replacement).not.toHaveProperty("session");
    expect(assets.clear).not.toHaveBeenCalled();
  });

  it("gracefully hands over a same-assignee Runtime after its Will generation changes", async () => {
    const { manager } = createManager();
    const firstWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const secondWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const oldDrain = deferred<void>();

    manager.setWill(async () => firstWill);
    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    manager.setWill(async () => secondWill);

    const routing = manager.route(record("room"));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());
    expect(state.runtimes).toHaveLength(1);
    expect(state.runtimes[0]?.stop).not.toHaveBeenCalled();

    oldDrain.resolve();
    await routing;

    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[1]?.options).toMatchObject({ will: secondWill });
  });

  it("uses factory capabilities only for the runtime created from that factory snapshot", async () => {
    const { manager, getAgentPluginFactories } = createManager();
    const factory = Object.assign(
      vi.fn(async () => ({ name: "plain" })),
      { requiresMessageId: true },
    );
    getAgentPluginFactories.mockReturnValueOnce([factory]).mockReturnValueOnce([]);

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(state.runtimes[0]?.options.includeMessageId).toBe(true);
    expect(state.runtimes[1]?.options.includeMessageId).toBe(false);
    expect(state.runtimes[0]?.options.agentPlugins).toEqual([{ name: "plain" }]);
  });

  it("injects channel-first JSONL storage into the runtime", async () => {
    const { manager } = createManager();

    await manager.route(record("room"));

    expect(state.runtimes[0]?.options.storage).toEqual(
      expect.objectContaining({ append: expect.any(Function) }),
    );
  });

  it("removes a reset runtime from the cache only after its teardown completes", async () => {
    const { manager } = createManager();

    await manager.route(record("room"));
    const first = state.runtimes[0];
    await manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", isDirect: false });
    await manager.route(record("room"));

    expect(first?.reset).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("evicts a torn-down runtime when its persisted cleanup reports a failure", async () => {
    const { manager } = createManager();

    await manager.route(record("room"));
    state.runtimes[0]?.reset.mockRejectedValueOnce(new Error("storage clear failed"));

    await expect(
      manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", isDirect: false }),
    ).rejects.toThrow("storage clear failed");
    await manager.route(record("room"));

    expect(state.runtimes).toHaveLength(2);
  });

  it("clears uncached channel storage and assets without creating a runtime", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets } = createManager(basePath);
    const scope: ChannelScope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "uncached",
      isDirect: false,
    };
    const storagePath = await new ChannelStorage(basePath).ensure(
      scope,
      "sessions",
      "messages.jsonl",
    );
    await writeFile(storagePath, "stored\n");

    await manager.reset(scope);

    expect(state.runtimes).toHaveLength(0);
    expect(assets.clear).toHaveBeenCalledWith(scope);
    await expect(access(storagePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reloads an active runtime without clearing persisted channel data", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-reload-"));
    const { manager, assets, storage } = createManager(basePath);
    storage.register("workspace");
    storage.register("custom");
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      isDirect: false,
    } satisfies ChannelScope;
    const persistedFiles = await Promise.all([
      storage.ensure(scope, "sessions", "messages.jsonl"),
      storage.ensure(scope, "assets", "asset.bin"),
      storage.ensure(scope, "workspace", "state.txt"),
      storage.ensure(scope, "custom", "state.json"),
    ]);
    await Promise.all(persistedFiles.map((path) => writeFile(path, "keep")));

    await manager.route(record("room"));
    const old = state.runtimes[0];
    await manager.reload(scope);

    expect(old?.beginDrain).toHaveBeenCalledOnce();
    expect(old?.drainAndStop).toHaveBeenCalledOnce();
    expect(old?.reset).not.toHaveBeenCalled();
    expect(assets.clear).not.toHaveBeenCalled();
    for (const path of persistedFiles) await expect(access(path)).resolves.toBeUndefined();
    expect(storage.list()).toHaveLength(1);
    expect(state.runtimes).toHaveLength(1);

    await manager.route(record("room", { messageId: "message-2", text: "again" }));
    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[1]?.init).toHaveBeenCalledOnce();
  });

  it("validates an uncached reload without creating a runtime", async () => {
    const { manager, database, resolveChatModel } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false };

    await manager.reload(scope);

    expect(database.get).toHaveBeenCalled();
    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(state.runtimes).toHaveLength(0);
  });

  it("coalesces concurrent reload calls for one draining generation", async () => {
    const { manager } = createManager();
    await manager.route(record("room"));
    const old = state.runtimes[0];
    const drain = deferred<void>();
    old?.drainAndStop.mockImplementation(async () => drain.promise);
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false };

    const first = manager.reload(scope);
    const second = manager.reload(scope);
    await vi.waitFor(() => expect(old?.beginDrain).toHaveBeenCalledOnce());
    drain.resolve();
    await Promise.all([first, second]);

    expect(old?.drainAndStop).toHaveBeenCalledOnce();
  });

  it("remains fail closed when reload cannot drain the old runtime", async () => {
    const { manager } = createManager();
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      isDirect: false,
    } satisfies ChannelScope;
    await manager.route(record("room"));
    const old = state.runtimes[0];
    old?.drainAndStop.mockRejectedValueOnce(new Error("drain failed"));

    await expect(manager.reload(scope)).rejects.toThrow("drain failed");
    await expect(manager.route(record("room"))).rejects.toThrow(
      "Channel handover failed; restart required",
    );
    expect(state.runtimes).toHaveLength(1);
  });

  it("retries an event that races with reload through bounded handover", async () => {
    const { manager } = createManager();
    await manager.route(record("room"));
    const old = state.runtimes[0];
    const handleEntered = deferred<void>();
    const releaseHandle = deferred<void>();
    const releaseDrain = deferred<void>();
    old?.handle.mockImplementationOnce(async () => {
      handleEntered.resolve();
      await releaseHandle.promise;
      throw new ChannelRuntimeDrainingError();
    });
    old?.drainAndStop.mockImplementation(async () => releaseDrain.promise);

    const racing = manager.route(
      record("room", { messageId: "message-race", text: "race" }),
    );
    await handleEntered.promise;
    const reloading = manager.reload({
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      isDirect: false,
    });
    await vi.waitFor(() => expect(old?.beginDrain).toHaveBeenCalledOnce());
    releaseHandle.resolve();
    releaseDrain.resolve();

    await Promise.all([racing, reloading]);
    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[1]?.handle).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "message-race" }),
    );
  });

  it("preserves channel metadata and registered namespaces when resetting uncached storage", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets, storage } = createManager(basePath);
    const scope: ChannelScope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "uncached",
      isDirect: false,
    };
    const dispose = storage.register("workspace");
    const messagesPath = await storage.ensure(scope, "sessions", "messages.jsonl");
    const assetsPath = await storage.ensure(scope, "assets", "asset");
    const workspacePath = await storage.ensure(scope, "workspace", "keep.txt");
    await Promise.all([
      writeFile(messagesPath, "stored\n"),
      writeFile(assetsPath, "asset\n"),
      writeFile(workspacePath, "keep\n"),
    ]);
    assets.clear.mockImplementation(async (target) => {
      await rm(await storage.ensure(target, "assets"), { recursive: true, force: true });
    });

    await manager.reset(scope);

    await expect(access(messagesPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(assetsPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(workspacePath)).resolves.toBeUndefined();
    await expect(access(join(basePath, "channels.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const [channel] = storage.list();
    if (!channel) throw new Error("Expected reset storage to retain a channel record");
    await expect(
      access(join(basePath, "channels", channel.directoryName, "channel.json")),
    ).resolves.toBeUndefined();
    dispose();
  });

  it("stops every cached runtime after a teardown failure and preserves assets", async () => {
    const { manager, assets } = createManager();

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));
    state.runtimes[0]?.stop.mockRejectedValueOnce(new Error("stop failed"));

    await manager.stop();

    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
    expect(state.runtimes[1]?.stop).toHaveBeenCalledOnce();
    expect(assets.clear).not.toHaveBeenCalled();
    await expect(manager.route(record("room-c"))).rejects.toThrow("Runtime manager is stopped");
    await expect(manager.stop()).resolves.toBeUndefined();
  });

  it("rejects reset after stop without clearing persisted channel data", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets } = createManager(basePath);
    const scope: ChannelScope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      isDirect: false,
    };
    const storagePath = await new ChannelStorage(basePath).ensure(
      scope,
      "sessions",
      "messages.jsonl",
    );
    await writeFile(storagePath, "persisted\n");
    await manager.route(record(scope.channelId));

    await manager.stop();

    await expect(manager.reset(scope)).rejects.toThrow("Runtime manager is stopped");
    await expect(access(storagePath)).resolves.toBeUndefined();
    expect(assets.clear).not.toHaveBeenCalled();
    expect(state.runtimes[0]?.reset).not.toHaveBeenCalled();
  });

  it("does not admit a route whose runtime finishes creating after stop begins", async () => {
    const { manager } = createManager();
    const pendingWill = deferred<Will>();
    const enteredFactory = deferred<void>();
    manager.setWill(() => {
      enteredFactory.resolve();
      return pendingWill.promise;
    });

    const routing = manager.route(record("room"));
    await enteredFactory.promise;
    const stopping = manager.stop();
    pendingWill.resolve({ decide: async () => "wait" });

    await expect(routing).rejects.toThrow("Runtime manager is stopped");
    await stopping;
    expect(state.runtimes[0]?.handle ?? vi.fn()).not.toHaveBeenCalled();
  });

  it("drains an old shared assignee outside the lifecycle coordinator before creating its replacement", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);

    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());

    const resetting = manager.reset({
      platform: "test",
      selfId: "other",
      channelId: "room",
      isDirect: false,
    });
    expect(state.runtimes[0]?.reset).not.toHaveBeenCalled();
    oldDrain.resolve();

    await Promise.all([routing, resetting]);
    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[1]?.options.scope).toMatchObject({ selfId: "other" });
    expect(state.runtimes[1]?.reset).toHaveBeenCalledOnce();
  });

  it("rejects a waiting shared event when reassignment changes again before phase two", async () => {
    const { manager, database, resolveChatModel } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());
    database.get.mockResolvedValue([{ assignee: "bot-1" }]);
    oldDrain.resolve();

    await expect(routing).rejects.toMatchObject({ reason: "mismatch" });
    expect(state.runtimes).toHaveLength(1);
    expect(resolveChatModel).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the phase-two shared assignee row is missing", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());
    database.get.mockResolvedValue([]);
    oldDrain.resolve();

    await expect(routing).rejects.toMatchObject({ reason: "missing" });
    expect(state.runtimes).toHaveLength(1);
  });

  it("fails closed when the phase-two shared assignee query fails", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());
    database.get.mockRejectedValue(new Error("database unavailable"));
    oldDrain.resolve();

    await expect(routing).rejects.toThrow("database unavailable");
    expect(state.runtimes).toHaveLength(1);
  });

  it("keeps delivery-failure completion on the old Runtime while shared handover drains", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]?.handle.mockResolvedValue({ kind: "run", eventId: "event-1", output: {} });
    const running = await manager.route(record("room"));
    if (running.kind !== "run") throw new Error("Expected a run result");
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());

    await running.delivery.fail({
      type: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      timestamp: 2,
      channel: { id: "room", type: 0 },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline" },
      },
      text: "Delivery failed",
      schemaVersion: 1,
      eventType: "delivery.failed",
    });
    expect(state.runtimes[0]?.handleInternal).toHaveBeenCalledOnce();
    expect(state.runtimes[1]).toBeUndefined();

    oldDrain.resolve();
    await routing;
  });

  it("bounds a shared handover to five waiting events and shares one drain", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const waiting = Array.from({ length: 5 }, (_, index) =>
      manager.route(
        record("room", { selfId: "other", messageId: `message-${index}` }),
      ),
    );
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());

    await expect(manager.route(record("room", { selfId: "other" }))).rejects.toThrow(
      "queue is full",
    );
    oldDrain.resolve();
    await Promise.all(waiting);

    expect(state.runtimes[0]?.drainAndStop).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("remains fail closed when an old shared Runtime cannot drain", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());
    oldDrain.reject(new Error("drain failed"));

    await expect(routing).rejects.toThrow("drain failed");
    await expect(manager.route(record("room", { selfId: "other" }))).rejects.toThrow(
      "handover failed",
    );
    expect(state.runtimes).toHaveLength(1);
  });

  it("keeps direct channels independent across self ids without handover", async () => {
    const { manager, database } = createManager();
    database.get.mockRejectedValue(new Error("direct channels do not query assignees"));

    await manager.route(record("room", { selfId: "bot-1", channel: { id: "room", type: 1 } }));
    await manager.route(record("room", { selfId: "other", channel: { id: "room", type: 1 } }));

    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[0]?.beginDrain).not.toHaveBeenCalled();
    expect(database.get).not.toHaveBeenCalled();
  });

  it("rejects excess handover events after a generation change without unbounded lifecycle tails", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    // Create Runtime at gen 0
    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);

    // Change the generation: all subsequent routes see the mismatch,
    // enter the handover path, reserve a slot before the lifecycle queue.
    manager.setWill(() => ({ decide: async () => "wait" as const }));

    // This route enters the handover path via wouldNeedHandover (gen mismatch).
    // It reserves slot 0 and triggers the drain.
    const routing = manager.route(record("room"));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());

    // Send 4 more routes — they reserve slots 1-4 (total 5: routing + 4 = 5)
    const waiters = Array.from({ length: 4 }, (_, i) =>
      manager.route(record("room", { messageId: `m-${i}` })),
    );

    // 6th event is excess and rejected before entering the lifecycle queue
    await expect(manager.route(record("room"))).rejects.toThrow("Channel handover queue is full");

    oldDrain.resolve();
    await Promise.all([routing, ...waiters]);
    expect(state.runtimes).toHaveLength(2);
  });

  it("stops a draining Runtime without publishing a replacement", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);
    database.get.mockResolvedValue([{ assignee: "other" }]);
    const routing = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => expect(state.runtimes[0]?.beginDrain).toHaveBeenCalledOnce());

    const stopping = manager.stop();
    oldDrain.reject(new Error("stopped"));
    await stopping;

    await expect(routing).rejects.toThrow(/stopped|handover/i);
    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(1);
  });

  it("rejects excess handover events without entering the lifecycle queue", async () => {
    const { manager, database } = createManager();
    const oldDrain = deferred<void>();

    await manager.route(record("room"));
    state.runtimes[0]!.drainAndStop.mockReturnValueOnce(oldDrain.promise);

    // Block the lifecycle at the assignee query for the first handover route
    const blockDb = deferred<[{ assignee: string }]>();
    const firstDbCall = database.get.mock.calls.length;
    database.get.mockImplementation(() => blockDb.promise);

    // The first handover route tries to enter the lifecycle but gets blocked
    const route1 = manager.route(record("room", { selfId: "other" }));
    await vi.waitFor(() => {
      // Route entered lifecycle and is blocked in assertCurrentAssignee
      expect(database.get).toHaveBeenCalledTimes(firstDbCall + 1);
    });

    // Lifecycle is blocked, so route1's lifecycle hasn't finished.
    // route1 reserves the first handover slot. We send 4 additional waiters
    // (5 total), and the 6th excess event is rejected by the pre-check.
    const waiters = Array.from({ length: 4 }, (_, i) =>
      manager.route(
        record("room", { selfId: "other", messageId: `m-${i}` }),
      ),
    );

    // The 6th excess should be rejected by the pre-check (counter >= 5)
    const excessCallsBefore = database.get.mock.calls.length;
    await expect(manager.route(record("room", { selfId: "other" }))).rejects.toThrow(
      "Channel handover queue is full",
    );
    // Assert no db.get call was made for the excess route (it didn't enter lifecycle)
    expect(database.get).toHaveBeenCalledTimes(excessCallsBefore);

    // Unblock the lifecycle and drain to let everything settle
    database.get.mockResolvedValue([{ assignee: "other" }]);
    blockDb.resolve([{ assignee: "other" }]);
    oldDrain.resolve();

    await Promise.all([route1, ...waiters]);
    expect(state.runtimes).toHaveLength(2);
  });

  it("stops a provisional Runtime created after the manager stops", async () => {
    const { manager } = createManager();
    const deferredWill = deferred<Will>();
    const enteredFactory = deferred<void>();

    manager.setWill(() => {
      enteredFactory.resolve();
      return deferredWill.promise;
    });

    const routing = manager.route(record("room"));
    await enteredFactory.promise;

    // Stop while Runtime creation is pending in the async Will factory
    const stopping = manager.stop();
    deferredWill.resolve({ decide: async () => "wait" });

    // The route should reject because assertOpen() fails after creation
    await expect(routing).rejects.toThrow("Runtime manager is stopped");
    await stopping;

    // The provisional Runtime should have been stopped exactly once
    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
  });

  it("discards a stale-generation Runtime created while a Will replacement was pending", async () => {
    const { manager } = createManager();
    const deferredWill = deferred<Will>();
    const enteredFactory = deferred<void>();

    const firstWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;
    const secondWill = { decide: vi.fn(async () => "wait" as const) } satisfies Will;

    manager.setWill(() => {
      enteredFactory.resolve();
      return deferredWill.promise;
    });

    // First event starts creation during first Will factory
    const routing = manager.route(record("room"));

    // Wait for the factory to be entered, then replace the Will
    await enteredFactory.promise;
    manager.setWill(async () => secondWill);

    // Resolve the original factory — the provisional Runtime has the old generation
    deferredWill.resolve(firstWill);

    // The Routing should complete and the event should reach only the current-generation Runtime
    await routing;
    await vi.waitFor(() => expect(state.runtimes).toHaveLength(2));

    // The second (current-gen) Runtime uses the second Will
    expect(state.runtimes[1]?.options.will).toBe(secondWill);

    // The first (stale) Runtime was stopped and discarded
    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
  });

  it("retries creation when generation changes during two consecutive async constructions", async () => {
    const { manager } = createManager();
    const deferreds = [deferred<Will>(), deferred<Will>()];
    let factoryCallIdx = 0;
    const makeFactory = () => async () => {
      const idx = factoryCallIdx++;
      const d = deferreds[idx];
      return d ? d.promise : Promise.resolve({ decide: async () => "wait" as const });
    };

    // First factory — gen becomes 1, createRuntime blocks on deferreds[0]
    manager.setWill(makeFactory());
    const routing = manager.route(record("room"));
    await vi.waitFor(() => expect(factoryCallIdx).toBe(1));

    // Bump gen while first factory is pending (gen becomes 2)
    manager.setWill(makeFactory());
    deferreds[0]!.resolve({ decide: async () => "wait" as const });

    // Loop retries. Second factory called, blocks on deferreds[1]
    await vi.waitFor(() => expect(factoryCallIdx).toBe(2));

    // Bump gen AGAIN while second factory is pending (gen becomes 3)
    manager.setWill(() => ({ decide: async () => "wait" as const }));
    deferreds[1]!.resolve({ decide: async () => "wait" as const });

    // Route completes
    await routing;

    // Two stale Runtimes were discarded and the third (current gen) is active
    expect(state.runtimes).toHaveLength(3);
    expect(state.runtimes[0]?.stop).toHaveBeenCalledOnce();
    expect(state.runtimes[1]?.stop).toHaveBeenCalledOnce();
    expect(state.runtimes[2]?.stop).not.toHaveBeenCalled();
  });
});
