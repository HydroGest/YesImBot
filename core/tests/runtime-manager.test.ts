import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { scopeMapKey, ChannelStorage, type ChannelScope } from "../src/channel.js";
import {
  Config,
  DEFAULT_IMAGE_BUDGET,
  resolveImageBudget,
  resolveReplyPacingConfig,
  type Config as CoreConfig,
} from "../src/config.js";
import type { MessageRecord } from "../src/input.js";
import {
  ChannelRuntime,
  type ChannelRuntimeOptions,
  RuntimeManager,
} from "../src/runtime/index.js";
import { RoutingWillEngine, WillingnessWillEngine } from "../src/runtime/will.js";

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
  stop: vi.fn(async () => undefined),
}));

function createManager(basePath = "/tmp/yesimbot-runtime-manager", will?: CoreConfig["will"]) {
  const ctx = new Context();
  const matchingBot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn() };
  const otherBot = { platform: "test", selfId: "other", sendMessage: vi.fn() };
  ctx.bots.push(matchingBot as never, otherBot as never);
  const model = { modelId: "test-model", modalities: { input: ["image"] } };
  let entry: { readonly modalities?: { readonly input?: readonly string[] } } = {};
  const resolveChatModel = vi.fn(() => ({ model, providerId: "test", entry }));
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, {
    database,
    "yesimbot.model": { resolveChatModel },
  });
  const storage = new ChannelStorage(basePath);
  const assets = {
    clear: vi.fn(async () => undefined),
    createStore: vi.fn(() => ({ clear: assets.clear, get: vi.fn(), put: vi.fn() })),
  };
  const getAgentPluginFactories = vi.fn(() => []);
  const config: CoreConfig = { basePath, chatModel: "test:model", will };
  return {
    manager: new RuntimeManager({
      ctx,
      config,
      logger: { warn: vi.fn() } as never,
      assets: assets as never,
      storage,
      getAgentPluginFactories,
    }),
    assets,
    resolveChatModel,
    matchingBot,
    otherBot,
    model,
    database,
    config,
    storage,
    getAgentPluginFactories,
    setEntry: (next: typeof entry) => {
      entry = next;
    },
  };
}

describe("RuntimeManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.runtimes = [];
    state.init.mockReset().mockResolvedValue(undefined);
    state.handle.mockReset().mockResolvedValue({ kind: "wait", eventId: "event-1" });
    state.stop.mockReset().mockResolvedValue(undefined);
    vi.spyOn(ChannelRuntime.prototype, "init").mockImplementation(function () {
      state.runtimes.push(this);
      return state.init();
    });
    vi.spyOn(ChannelRuntime.prototype, "handle").mockImplementation(async () => state.handle());
    vi.spyOn(ChannelRuntime.prototype, "stop").mockImplementation(() => state.stop());
  });

  it("constructs one real runtime for concurrent first events with one canonical identity", async () => {
    const { manager } = createManager();

    await Promise.all([manager.route(record("room")), manager.route(record("room"))]);

    expect(state.runtimes).toHaveLength(1);
    expect(state.handle).toHaveBeenCalledTimes(2);
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

  it("uses one identity for shared scopes and distinct identities for direct scopes", () => {
    const shared = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      isDirect: false,
    });
    const direct = (selfId: string): ChannelScope => ({
      platform: "test",
      selfId,
      channelId: "room",
      isDirect: true,
    });

    expect(scopeMapKey(shared("bot-a"))).toBe(scopeMapKey(shared("bot-b")));
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

  it("uses routing by default and willingness only when selected", async () => {
    const routing = createManager();
    const willingness = createManager("/tmp/yesimbot-willingness", { engine: "willingness" });

    await routing.manager.route(record("routing"));
    await willingness.manager.route(record("willingness"));

    expect(runtimeOptions(state.runtimes[0]!).will).toBeInstanceOf(RoutingWillEngine);
    expect(runtimeOptions(state.runtimes[1]!).will).toBeInstanceOf(WillingnessWillEngine);
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

  it("stops and replaces a shared runtime when selfId changes", async () => {
    const { manager } = createManager();
    await manager.route(record("room"));
    const first = state.runtimes[0];

    await manager.route(record("room", { selfId: "other" }));

    expect(first?.stop).toHaveBeenCalledOnce();
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
    const { manager, model, getAgentPluginFactories } = createManager();
    const first = { name: "first" };
    const second = { name: "second" };
    getAgentPluginFactories
      .mockReturnValueOnce([async () => first])
      .mockReturnValue([async () => second]);

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(runtimeOptions(state.runtimes[0]!)).toMatchObject({ model, agentPlugins: [first] });
    expect(runtimeOptions(state.runtimes[1]!)).toMatchObject({ model, agentPlugins: [second] });
  });

  it("resolves imageInput disablement and defaults before snapshotting each runtime", async () => {
    const { manager, config, setEntry } = createManager();

    expect(resolveImageBudget(false, true)).toBeNull();
    expect(resolveImageBudget(undefined, true)).toEqual(DEFAULT_IMAGE_BUDGET);
    expect(resolveImageBudget({}, false)).toBeNull();
    await manager.route(record("room"));
    const first = runtimeOptions(state.runtimes[0]!);

    expect(first.imageBudget).toBeNull();
    setEntry({ modalities: { input: ["image"] } });
    config.imageInput = { maxCount: 2, maxBytesPerImage: 1024, maxTotalBytes: 2048 };
    await manager.route(record("room"));
    expect(state.runtimes).toHaveLength(1);

    await manager.route(record("room", { selfId: "other" }));
    expect(runtimeOptions(state.runtimes[1]!).imageBudget).toEqual({
      maxCount: 2,
      maxBytesPerImage: 1024,
      maxTotalBytes: 2048,
    });
  });

  it("returns a mutable resolved pacing configuration", () => {
    expect(Object.isFrozen(resolveReplyPacingConfig())).toBe(false);
  });

  it("uses factory message-id capability from each creation snapshot", async () => {
    const { manager, getAgentPluginFactories } = createManager();
    const factory = Object.assign(
      vi.fn(async () => ({ name: "tool" })),
      { requiresMessageId: true },
    );
    getAgentPluginFactories.mockReturnValueOnce([factory]).mockReturnValueOnce([]);

    await manager.route(record("room-a"));
    await manager.route(record("room-b"));

    expect(runtimeOptions(state.runtimes[0]!).includeMessageId).toBe(true);
    expect(runtimeOptions(state.runtimes[1]!).includeMessageId).toBe(false);
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
      isDirect: false,
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
      manager.reset({ platform: "test", selfId: "bot-1", channelId: "room", isDirect: false }),
    ).rejects.toThrow("storage clear failed");
    await manager.route(record("room"));
    expect(assets.clear).toHaveBeenCalledOnce();
    expect(state.runtimes).toHaveLength(2);
  });

  it("clears uncached sessions and assets without creating a runtime", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "uncached",
      isDirect: false,
    } satisfies ChannelScope;
    const path = join(
      await new ChannelStorage(basePath).getStoragePath(scope),
      "sessions",
      "messages.jsonl",
    );
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
      isDirect: false,
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
    await Promise.all([
      writeFile(messages, "stored"),
      writeFile(asset, "asset"),
      writeFile(workspace, "keep"),
    ]);
    assets.createStore.mockImplementation((target) => ({
      get: vi.fn(),
      put: vi.fn(),
      clear: async () =>
        rm(join(await storage.getStoragePath(target), "assets"), { recursive: true, force: true }),
    }));

    await manager.reset(scope);
    await expect(access(messages)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(asset)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(workspace)).resolves.toBeUndefined();
    await expect(
      access(join(await storage.getStoragePath(scope), "channel.json")),
    ).resolves.toBeUndefined();
  });

  it("rejects reset after stop without clearing persisted data", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets } = createManager(basePath);
    const scope = {
      platform: "test",
      selfId: "bot-1",
      channelId: "room",
      isDirect: false,
    } satisfies ChannelScope;
    const path = join(
      await new ChannelStorage(basePath).getStoragePath(scope),
      "sessions",
      "messages.jsonl",
    );
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "persisted");
    await manager.route(record("room"));
    await manager.stop();

    await expect(manager.reset(scope)).rejects.toThrow("Runtime manager is stopped");
    await expect(access(path)).resolves.toBeUndefined();
    expect(assets.clear).not.toHaveBeenCalled();
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
