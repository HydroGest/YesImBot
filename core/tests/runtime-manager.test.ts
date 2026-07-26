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
    stop: ReturnType<typeof vi.fn>;
  }>,
  nextInit: undefined as (() => Promise<void>) | undefined,
}));

import { channelIdentity, type ChannelScope } from "../src/channel/index.js";
import {
  Config,
  DEFAULT_MULTIMEDIA_IMAGE_POLICY,
  type Config as CoreConfig,
} from "../src/config.js";
import type { EventRecord, MessageRecord } from "../src/event/index.js";
import { ChannelRuntimeDrainingError, RuntimeManager } from "../src/runtime/index.js";
import { ChannelStorage } from "../src/storage/index.js";
import { channelRecord } from "../src/storage/manifest.js";
import { RoutingWillEngine, WillingnessWillEngine } from "../src/will/index.js";

function record(channelId: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
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

function createManager(basePath = "/tmp/yesimbot-runtime-manager", will?: CoreConfig["will"]) {
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
  const config: CoreConfig = { basePath, chatModel: "test:model", will };
  const manager = new RuntimeManager({
    ctx,
    config,
    logger: { debug: vi.fn(), warn: vi.fn() } as never,
    assets: assets as never,
    storage,
    getAgentPluginFactories,
    createChannelRuntime: (options) => {
      const runtime = {
        init: vi.fn(async () => {
          const next = state.nextInit;
          state.nextInit = undefined;
          await next?.();
        }),
        handle: vi.fn(async () => ({ kind: "wait" as const, eventId: "event-1" })),
        handleInternal: vi.fn(async () => ({ kind: "wait" as const, eventId: "event-1" })),
        acquireDeliveryLease: vi.fn(() => vi.fn()),
        beginDrain: vi.fn(),
        drainAndStop: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      };
      state.runtimes.push({ options, ...runtime });
      return runtime as never;
    },
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

    expect(state.runtimes[0]?.options.will).toBeInstanceOf(RoutingWillEngine);
    expect(state.runtimes[1]?.options.will).toBeInstanceOf(WillingnessWillEngine);
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

  it("routes an admitted shared record without another assignee query", async () => {
    const { manager, database, resolveChatModel } = createManager();

    await manager.route(record("room"));

    expect(database.get).not.toHaveBeenCalled();
    expect(resolveChatModel).toHaveBeenCalledOnce();
  });

  it("requires explicit reload before routing an admitted shared record for another self id", async () => {
    const { manager, resolveChatModel } = createManager();

    await manager.route(record("room"));
    const cached = state.runtimes[0];

    await expect(manager.route(record("room", { selfId: "other" }))).rejects.toMatchObject({
      name: "RuntimeReloadRequiredError",
    });

    expect(cached?.handle).toHaveBeenCalledOnce();
    expect(cached?.beginDrain).not.toHaveBeenCalled();
    expect(cached?.drainAndStop).not.toHaveBeenCalled();
    expect(resolveChatModel).toHaveBeenCalledOnce();
  });

  it("rejects an admitted route while an explicit reload drains", async () => {
    const { manager } = createManager();
    const drain = deferred<void>();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false };

    await manager.route(record("room"));
    const cached = state.runtimes[0];
    cached?.drainAndStop.mockImplementation(async () => drain.promise);

    const reloading = manager.reload(scope);
    await vi.waitFor(() => expect(cached?.beginDrain).toHaveBeenCalledOnce());
    const routing = manager.route(record("room"));
    await Promise.resolve();

    expect(cached?.handle).toHaveBeenCalledOnce();
    drain.resolve();
    await reloading;
    await expect(routing).rejects.toMatchObject({ name: "RuntimeReloadInProgressError" });
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

  it("snapshots the model and agent plugins when creating a runtime", async () => {
    const { manager, model, resolveChatModel, getAgentPluginFactories } = createManager();
    const firstPlugin = { name: "first" };
    const secondPlugin = { name: "second" };
    getAgentPluginFactories
      .mockReturnValueOnce([async () => firstPlugin])
      .mockReturnValue([async () => secondPlugin]);

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(resolveChatModel).toHaveBeenCalledWith("test:model");
    expect(state.runtimes[0]?.options).toMatchObject({ model });
    expect(state.runtimes[0]?.options.agentPlugins).toEqual([firstPlugin]);
    expect(state.runtimes[1]?.options).toMatchObject({ model });
    expect(state.runtimes[1]?.options.agentPlugins).toEqual([secondPlugin]);
  });

  it("snapshots resolved model media capability and policy until non-destructive reload", async () => {
    const { manager, config, setEntry, assets } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false };

    await manager.route(record("room"));
    const first = state.runtimes[0]?.options;

    expect(first?.imageInput).toBe(false);
    expect(first?.mediaPolicy).toEqual(DEFAULT_MULTIMEDIA_IMAGE_POLICY);
    expect(Object.isFrozen(first?.mediaPolicy)).toBe(true);
    expect(first?.will).toBeInstanceOf(RoutingWillEngine);
    expect(first).not.toHaveProperty("session");

    setEntry({ modalities: { input: ["image"] } });
    config.multimedia = {
      enabled: false,
      image: {
        selection: "fifo",
        maxCount: 2,
        maxBytesPerImage: 1024,
        maxTotalBytes: 2048,
      },
    };
    config.will = { engine: "willingness", base: { text: 12 } };

    await manager.route(record("room"));
    expect(state.runtimes).toHaveLength(1);
    expect(first?.imageInput).toBe(false);
    expect(first?.mediaPolicy).toMatchObject({ enabled: true, selection: "current-first" });

    await manager.reload(scope);
    await manager.route(record("room"));
    const replacement = state.runtimes[1]?.options;

    expect(replacement?.imageInput).toBe(true);
    expect(replacement?.mediaPolicy).toEqual({
      enabled: false,
      maxCount: 2,
      maxBytesPerImage: 1024,
      maxTotalBytes: 2048,
      selection: "fifo",
    });
    expect(replacement?.will).toBeInstanceOf(WillingnessWillEngine);
    expect(replacement).not.toHaveProperty("session");
    expect(assets.clear).not.toHaveBeenCalled();
  });

  it("materializes renamed multimedia defaults from the single policy source", () => {
    const configured = Config({ basePath: "/tmp/yesimbot-config", chatModel: "test:model" });

    expect(configured.multimedia?.image).toMatchObject({
      maxCount: DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxCount,
      maxBytesPerImage: DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxBytesPerImage,
      maxTotalBytes: DEFAULT_MULTIMEDIA_IMAGE_POLICY.maxTotalBytes,
    });
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

  it("uses the manager cleanup contract for a cached reset", async () => {
    const { manager, assets } = createManager();

    await manager.route(record("room"));
    const first = state.runtimes[0];
    await manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", isDirect: false });
    await manager.route(record("room"));

    expect(first?.drainAndStop).toHaveBeenCalledOnce();
    expect(assets.clear).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("evicts a reset runtime after the manager cleanup reports a failure", async () => {
    const { manager, storage, assets } = createManager();

    await manager.route(record("room"));
    vi.spyOn(storage, "ensure").mockRejectedValueOnce(new Error("storage clear failed"));

    await expect(
      manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", isDirect: false }),
    ).rejects.toThrow("storage clear failed");
    await manager.route(record("room"));

    expect(assets.clear).toHaveBeenCalledOnce();
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
    expect(assets.clear).not.toHaveBeenCalled();
    for (const path of persistedFiles) await expect(access(path)).resolves.toBeUndefined();
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
      "Runtime reload failed; restart required",
    );
    expect(state.runtimes).toHaveLength(1);
  });

  it("keeps another channel routable after one reload fails", async () => {
    const { manager } = createManager();
    const failedScope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room-a",
      isDirect: false,
    } satisfies ChannelScope;

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));
    state.runtimes[0]?.drainAndStop.mockRejectedValueOnce(new Error("drain failed"));

    await expect(manager.reload(failedScope)).rejects.toThrow("drain failed");
    await expect(
      manager.route(record("room-b", { messageId: "message-b" })),
    ).resolves.toMatchObject({
      kind: "wait",
    });
  });

  it("rejects an event that races with reload instead of retrying it", async () => {
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

    const racing = manager.route(record("room", { messageId: "message-race", text: "race" }));
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

    await reloading;
    await expect(racing).rejects.toMatchObject({ name: "RuntimeReloadInProgressError" });
    expect(state.runtimes).toHaveLength(1);
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
    await expect(
      access(join(basePath, "channels", channelRecord(scope).directoryName, "channel.json")),
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
  });

  it("keeps direct channels independent across self ids", async () => {
    const { manager, database } = createManager();
    database.get.mockRejectedValue(new Error("direct channels do not query assignees"));

    await manager.route(record("room", { selfId: "bot-1", channel: { id: "room", type: 1 } }));
    await manager.route(record("room", { selfId: "other", channel: { id: "room", type: 1 } }));

    expect(state.runtimes).toHaveLength(2);
    expect(state.runtimes[0]?.beginDrain).not.toHaveBeenCalled();
    expect(database.get).not.toHaveBeenCalled();
  });
});
