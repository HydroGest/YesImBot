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
    handleInternal: ReturnType<typeof vi.fn>;
    acquireDeliveryLease: ReturnType<typeof vi.fn>;
    beginDrain: ReturnType<typeof vi.fn>;
    drainAndStop: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../src/runtime/channel.js", () => ({
  ChannelRuntime: class {
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
  const database = { get: vi.fn(async () => [{ assignee: "bot-1" }]) };
  Object.assign(ctx, { "yesimbot.model": { resolveChatModel }, database });
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

  it("revalidates shared assignment inside the lifecycle before creating a runtime", async () => {
    const { manager, database, resolveChatModel } = createManager();
    database.get.mockResolvedValue([{ assignee: "other" }]);

    await expect(manager.route(record("room"))).rejects.toMatchObject({ reason: "mismatch" });

    expect(resolveChatModel).not.toHaveBeenCalled();
    expect(state.runtimes).toHaveLength(0);
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
    await expect(access(join(basePath, "channels.json"))).resolves.toBeUndefined();
    await expect(
      access(join(basePath, "channels", storage.list()[0]!.key, "channel.json")),
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
      content: "Delivery failed",
    } as EventRecord<"delivery.failed">);
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
        record("room", { selfId: "other", message: { id: `message-${index}`, content: "hello" } }),
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
});
