import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel/index.js";
import type { Config as CoreConfig } from "../src/config.js";
import type { MessageRecord } from "../src/event/index.js";
import { ChannelRuntime, RuntimeManager } from "../src/runtime/index.js";
import { ChannelStorage } from "../src/storage/index.js";

function record(channelId: string, overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    schemaVersion: 3,
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

const state = vi.hoisted(() => ({
  runtimes: [] as ChannelRuntime[],
  init: vi.fn(async () => undefined),
  handle: vi.fn(async () => ({ kind: "wait" as const, eventId: "event-1" })),
  drainAndStop: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}));

function createManager(basePath = "/tmp/yesimbot-runtime-manager") {
  const ctx = new Context();
  const matchingBot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn() };
  const otherBot = { platform: "test", selfId: "other", sendMessage: vi.fn() };
  ctx.bots.push(matchingBot as never, otherBot as never);
  const resolveChatModel = vi.fn(() => ({ model: {}, providerId: "test", entry: {} }));
  Object.assign(ctx, {
    database: { get: vi.fn(async () => [{ assignee: "bot-1" }]) },
    "yesimbot.model": { resolveChatModel },
  });
  const assets = { clear: vi.fn(async () => undefined), readByAssetId: vi.fn() };
  const storage = new ChannelStorage(basePath);
  const config: CoreConfig = { basePath, chatModel: "test:model" };
  return {
    manager: new RuntimeManager({
      ctx,
      config,
      logger: { warn: vi.fn() } as never,
      assets: assets as never,
      storage,
      getAgentPluginFactories: () => [],
    }),
    assets,
    resolveChatModel,
  };
}

describe("RuntimeManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.runtimes = [];
    state.init.mockReset().mockResolvedValue(undefined);
    state.handle.mockReset().mockResolvedValue({ kind: "wait", eventId: "event-1" });
    state.drainAndStop.mockReset().mockResolvedValue(undefined);
    state.stop.mockReset().mockResolvedValue(undefined);
    vi.spyOn(ChannelRuntime.prototype, "init").mockImplementation(function () {
      state.runtimes.push(this);
      return state.init();
    });
    vi.spyOn(ChannelRuntime.prototype, "handle").mockImplementation(async () => state.handle());
    vi.spyOn(ChannelRuntime.prototype, "drainAndStop").mockImplementation(() => state.drainAndStop());
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

  it("drains a cached runtime before reset removes it", async () => {
    const { manager, assets } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false } satisfies ChannelScope;
    const release = deferred();
    await manager.route(record("room"));
    state.drainAndStop.mockImplementationOnce(async () => release.promise);

    const resetting = manager.reset(scope);
    await vi.waitFor(() => expect(state.drainAndStop).toHaveBeenCalledOnce());
    expect(assets.clear).not.toHaveBeenCalled();
    release.resolve();
    await resetting;

    expect(assets.clear).toHaveBeenCalledOnce();
  });

  it("keeps reload fail-closed after drain rejection", async () => {
    const { manager } = createManager();
    const scope = { platform: "test", selfId: "bot-1", channelId: "room", isDirect: false } satisfies ChannelScope;
    await manager.route(record("room"));
    state.drainAndStop.mockRejectedValueOnce(new Error("drain failed"));

    await expect(manager.reload(scope)).rejects.toThrow("drain failed");
    await expect(manager.route(record("room"))).rejects.toThrow("Runtime reload failed; restart required");
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
});
