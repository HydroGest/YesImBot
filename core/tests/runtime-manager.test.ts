import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  runtimes: [] as Array<{
    readonly options: Record<string, unknown>;
    handle: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../src/runtime/channel.js", () => ({
  ChannelRuntime: class {
    readonly handle = vi.fn(async () => ({ kind: "wait", eventId: "event-1" }));
    readonly reset = vi.fn(async () => undefined);
    readonly stop = vi.fn(async () => undefined);

    constructor(readonly options: Record<string, unknown>) {
      state.runtimes.push(this);
    }
  },
}));

import type { ChannelScope } from "../src/channel/index.js";
import type { EventRecord } from "../src/event/index.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import { ChannelStorage } from "../src/storage/index.js";
import type { Will } from "../src/will/index.js";

function record(
  channelId: string,
  overrides: Partial<EventRecord<"message">> = {},
): EventRecord<"message"> {
  return {
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: channelId, type: 0 },
    user: { id: "user-1", name: "User" },
    message: { id: `message-${channelId}`, content: "hello" },
    content: "hello",
    ...overrides,
  } as EventRecord<"message">;
}

function createManager(basePath = "/tmp/yesimbot-runtime-manager") {
  const ctx = new Context();
  const matchingBot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn() };
  const otherBot = { platform: "test", selfId: "other", sendMessage: vi.fn() };
  ctx.bots.push(otherBot as never, matchingBot as never);
  const model = { modelId: "test-model" };
  const resolveChatModel = vi.fn(() => ({ model }));
  Object.assign(ctx, { "yesimbot.model": { resolveChatModel } });
  const assets = { clear: vi.fn(async () => undefined), readByAssetId: vi.fn() };
  const getAgentPluginFactories = vi.fn(() => []);
  const storage = new ChannelStorage(basePath);
  const manager = new RuntimeManager({
    ctx,
    config: { basePath, chatModel: "test:model" },
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
    resolveChatModel,
    assets,
    getAgentPluginFactories,
    storage,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("RuntimeManager", () => {
  beforeEach(() => {
    state.runtimes = [];
  });

  it("creates one runtime for concurrent first events with the same canonical key", async () => {
    const { manager } = createManager();

    await Promise.all([
      manager.route(record("room", { guild: { id: "guild-a" } })),
      manager.route(record("room", { guild: { id: "guild-b" } })),
    ]);

    expect(state.runtimes).toHaveLength(1);
    expect(state.runtimes[0]?.handle).toHaveBeenCalledTimes(2);
  });

  it("keeps different canonical channel keys isolated", async () => {
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
    const storagePath = await new ChannelStorage(basePath).ensure(scope, "sessions", "messages.jsonl");
    await writeFile(storagePath, "stored\n");

    await manager.reset(scope);

    expect(state.runtimes).toHaveLength(0);
    expect(assets.clear).toHaveBeenCalledWith(scope);
    await expect(access(storagePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves channel metadata and registered namespaces when resetting uncached storage", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "yesimbot-runtime-manager-"));
    const { manager, assets, storage } = createManager(basePath);
    const scope: ChannelScope = {
      platform: "test", selfId: "bot-1", channelId: "uncached", isDirect: false,
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
    await expect(access(join(basePath, "channels.json"))).resolves.toBeUndefined();
    await expect(access(join(basePath, "channels", storage.list()[0]!.key, "channel.json"))).resolves.toBeUndefined();
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
    const storagePath = await new ChannelStorage(basePath).ensure(scope, "sessions", "messages.jsonl");
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
});
