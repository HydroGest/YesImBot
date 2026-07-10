import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "@koishijs/core";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeMocks = vi.hoisted(() => {
  const state = {
    runtimes: [] as Array<{
      interrupt: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      append: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      wait: ReturnType<typeof vi.fn>;
      channel: { emit: (event: unknown) => void; subscribe: ReturnType<typeof vi.fn> };
    }>,
    storages: [] as Array<{
      path: string;
      clear: ReturnType<typeof vi.fn>;
      append: ReturnType<typeof vi.fn>;
      read: ReturnType<typeof vi.fn>;
    }>,
    nextInterrupt: undefined as (() => Promise<void>) | undefined,
    nextStop: undefined as (() => Promise<void>) | undefined,
    nextClear: undefined as (() => Promise<void>) | undefined,
  };

  return {
    state,
    reset() {
      state.runtimes.length = 0;
      state.storages.length = 0;
      state.nextInterrupt = undefined;
      state.nextStop = undefined;
      state.nextClear = undefined;
    },
  };
});

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  type RuntimeEvent = { name: string };

  return {
    ...actual,
    createAgent: vi.fn(() => {
      const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
      const runtime = {
        id: `runtime_${runtimeMocks.state.runtimes.length + 1}`,
        channel: {
          emit(event: RuntimeEvent) {
            listeners.get(event.name)?.forEach((listener) => listener(event));
          },
          subscribe: vi.fn((name: string, listener: (event: RuntimeEvent) => void) => {
            const bucket = listeners.get(name) ?? new Set();
            bucket.add(listener);
            listeners.set(name, bucket);
            return () => bucket.delete(listener);
          }),
        },
        storage: undefined,
        state: {} as never,
        init: vi.fn(),
        stop: vi.fn(async () => {
          await runtimeMocks.state.nextStop?.();
        }),
        append: vi.fn(async () => undefined),
        send: vi.fn(() => "turn_1"),
        run: vi.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield { type: "turn.queued", turnId: "turn_1" };
            yield { type: "turn.done", turnId: "turn_1" };
          },
        })),
        wait: vi.fn(async () => undefined),
        interrupt: vi.fn(async () => {
          await runtimeMocks.state.nextInterrupt?.();
        }),
        setTools: vi.fn(),
        getModel: vi.fn(),
      };
      runtimeMocks.state.runtimes.push(runtime);
      return runtime;
    }),
  };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn((path: string) => {
    const storage = {
      path,
      append: vi.fn(async () => undefined),
      read: vi.fn(async () => []),
      clear: vi.fn(async () => {
        await runtimeMocks.state.nextClear?.();
      }),
    };
    runtimeMocks.state.storages.push(storage);
    return storage;
  }),
}));

import { type Config } from "../src/config.js";
import { createChannelScopeId, type ChannelScope } from "../src/channel.js";
import { apply } from "../src/index.js";
import { YesImBotService } from "../src/service.js";

const config: Config = {
  basePath: "data/yesimbot-core",
  chatModel: "mock:model",
  logLevel: 2,
};

const scope: ChannelScope = {
  platform: "discord",
  selfId: "bot",
  channelId: "room",
};

function createContext() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/athena";
  (ctx as Context & {
    "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } };
  })["yesimbot.model"] = {
    resolveChatModel() {
      return { model: { modelId: "mock:model" } };
    },
  };
  return ctx;
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    platform: scope.platform,
    selfId: scope.selfId,
    channelId: scope.channelId,
    userId: "user",
    content: "hello",
    send: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("channel reset", () => {
  beforeEach(() => {
    runtimeMocks.reset();
  });

  it("interrupts and stops cached runtime, clears storage, and evicts the cache entry", async () => {
    const service = new YesImBotService(createContext(), config);

    await service.handleSession(createSession());
    expect(runtimeMocks.state.runtimes).toHaveLength(1);
    expect(runtimeMocks.state.storages).toHaveLength(1);

    const firstRuntime = runtimeMocks.state.runtimes[0];
    const firstStorage = runtimeMocks.state.storages[0];

    await service.resetChannel(scope);
    await service.handleSession(createSession({ content: "again" }));

    expect(firstRuntime.interrupt).toHaveBeenCalledWith("reset");
    expect(firstRuntime.stop).toHaveBeenCalledTimes(1);
    expect(firstStorage.clear).toHaveBeenCalledTimes(1);
    expect(firstRuntime.stop.mock.invocationCallOrder[0]).toBeLessThan(
      firstStorage.clear.mock.invocationCallOrder[0],
    );
    expect(runtimeMocks.state.runtimes).toHaveLength(2);
  });

  it("clears jsonl storage even when the runtime was never cached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "athena-core-reset-"));
    const basePath = join(dir, "data");
    try {
      const uncachedService = new YesImBotService(createContext(), { ...config, basePath });
      const id = createChannelScopeId(scope);
      const sessionPath = join(basePath, "channels", id, "sessions", "messages.jsonl");

      await uncachedService.resetChannel(scope);

      expect(runtimeMocks.state.storages).toHaveLength(1);
      expect(runtimeMocks.state.storages[0].path).toBe(sessionPath);
      expect(runtimeMocks.state.storages[0].clear).toHaveBeenCalledTimes(1);
      await expect(readFile(join(basePath, "channels", id, "scope.json"), "utf8")).resolves.toEqual(
        expect.stringContaining(scope.channelId),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("waits for storage cleanup before reset resolves", async () => {
    let releaseClear!: () => void;
    runtimeMocks.state.nextClear = () =>
      new Promise<void>((resolve) => {
        releaseClear = resolve;
      });

    const service = new YesImBotService(createContext(), config);
    await service.handleSession(createSession());

    let settled = false;
    const reset = service.resetChannel(scope).then(() => {
      settled = true;
    });

    await expect
      .poll(() => runtimeMocks.state.storages[0]?.clear.mock.calls.length ?? 0)
      .toBe(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseClear();
    await reset;
    expect(settled).toBe(true);
  });

  it("waits for interrupt, stop, and clear in order before reset resolves", async () => {
    let releaseInterrupt!: () => void;
    let releaseStop!: () => void;
    let releaseClear!: () => void;

    runtimeMocks.state.nextInterrupt = () =>
      new Promise<void>((resolve) => {
        releaseInterrupt = resolve;
      });
    runtimeMocks.state.nextStop = () =>
      new Promise<void>((resolve) => {
        releaseStop = resolve;
      });
    runtimeMocks.state.nextClear = () =>
      new Promise<void>((resolve) => {
        releaseClear = resolve;
      });

    const service = new YesImBotService(createContext(), config);
    await service.handleSession(createSession());

    const runtime = runtimeMocks.state.runtimes[0];
    const storage = runtimeMocks.state.storages[0];

    let settled = false;
    const reset = service.resetChannel(scope).then(() => {
      settled = true;
    });

    await expect.poll(() => runtime.interrupt.mock.calls.length).toBe(1);
    await Promise.resolve();
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseInterrupt();
    await expect.poll(() => runtime.stop.mock.calls.length).toBe(1);
    await Promise.resolve();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseStop();
    await expect.poll(() => storage.clear.mock.calls.length).toBe(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseClear();
    await reset;
    expect(settled).toBe(true);
  });

  it("interrupts and stops cached runtimes during service stop without clearing storage", async () => {
    const service = new YesImBotService(createContext(), config);

    await service.handleSession(createSession());
    const firstRuntime = runtimeMocks.state.runtimes[0];
    const firstStorage = runtimeMocks.state.storages[0];

    await service.stop();
    await service.handleSession(createSession({ content: "after stop" }));

    expect(firstRuntime.interrupt).toHaveBeenCalledWith("dispose");
    expect(firstRuntime.stop).toHaveBeenCalledTimes(1);
    expect(firstStorage.clear).not.toHaveBeenCalled();
    expect(runtimeMocks.state.runtimes).toHaveLength(2);
  });

  it("waits for cached runtime interrupt and stop before service stop resolves", async () => {
    let releaseInterrupt!: () => void;
    let releaseStop!: () => void;

    runtimeMocks.state.nextInterrupt = () =>
      new Promise<void>((resolve) => {
        releaseInterrupt = resolve;
      });
    runtimeMocks.state.nextStop = () =>
      new Promise<void>((resolve) => {
        releaseStop = resolve;
      });

    const service = new YesImBotService(createContext(), config);
    await service.handleSession(createSession());

    const runtime = runtimeMocks.state.runtimes[0];

    let settled = false;
    const stop = service.stop().then(() => {
      settled = true;
    });

    await expect.poll(() => runtime.interrupt.mock.calls.length).toBe(1);
    await Promise.resolve();
    expect(runtime.stop).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseInterrupt();
    await expect.poll(() => runtime.stop.mock.calls.length).toBe(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseStop();
    await stop;
    expect(settled).toBe(true);
  });

  it("registers an admin-only reset command that always targets the current channel", async () => {
    const ctx = createContext();
    apply(ctx as never, config);
    const resetSpy = vi.spyOn(ctx.yesimbot, "resetChannel").mockResolvedValueOnce(undefined);

    const command = ctx.$commander.get("yesimbot.reset");
    const action = (
      command as unknown as {
        _actions: Array<(argv: { session?: ReturnType<typeof createSession> }) => Promise<void>>;
      }
    )._actions[0];
    const session = createSession({ channelId: "current-channel", selfId: "self-1" });

    expect(command.config.authority).toBe(4);
    expect(command.declaration).not.toContain("<");

    await action({ session });

    expect(resetSpy).toHaveBeenCalledWith({
      platform: "discord",
      selfId: "self-1",
      channelId: "current-channel",
    });
  });
});
