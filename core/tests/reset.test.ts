import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const state = vi.hoisted(() => ({
  operations: [] as string[],
  createAgent: vi.fn(),
  storageClear: vi.fn(),
  reset() {
    this.operations = [];
    this.createAgent.mockReset();
    this.storageClear.mockReset();
    this.storageClear.mockImplementation(async () => {
      this.operations.push("storage.clear");
    });
    this.createAgent.mockImplementation(() => ({
      id: `runtime-${this.createAgent.mock.calls.length}`,
      channel: { emit: vi.fn(), subscribe: vi.fn(() => () => undefined) },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(async () => undefined),
      stop: vi.fn(async () => {
        this.operations.push("stop");
      }),
      append: vi.fn(async () => undefined),
      send: vi.fn(() => "turn"),
      run: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
      wait: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => {
        this.operations.push("interrupt");
      }),
      setTools: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      clear: vi.fn(async () => undefined),
      getActiveTurnId: vi.fn(() => undefined),
      isIdle: vi.fn(() => true),
    }));
  },
}));

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return { ...actual, createAgent: state.createAgent };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: state.storageClear,
  })),
}));

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>();
  return { ...actual, ensureChannelScopeRecord: vi.fn(async () => undefined) };
});

import type { Config } from "../src/config.js";
import { YesImBotService } from "../src/runtime/service.js";
import { createTestPlatformService } from "./platform-service-helper.js";

const config: Config = { basePath: "data/yesimbot-core", chatModel: "mock:model" };
const scope = { platform: "test", selfId: "bot", channelId: "room" };

function createContext() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/athena";
  (ctx as Context & { "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } } })[
    "yesimbot.model"
  ] = { resolveChatModel: () => ({ model: { modelId: "mock:model" } }) };
  return ctx;
}

function session(messageId: string) {
  return {
    ...scope,
    userId: "user",
    messageId,
    content: "hello",
    subtype: "private",
    isDirect: true,
    send: vi.fn(async () => undefined),
  } as never;
}

describe("channel reset", () => {
  beforeEach(() => state.reset());

  it("runs reset teardown in order and recreates a fresh agent", async () => {
    const ctx = createContext();
    const platform = createTestPlatformService({ ctx: ctx as never });
    vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
      state.operations.push("assets.clear");
    });
    const service = new YesImBotService(ctx, config);

    await service.handleSession(session("a"));
    const firstRuntime = state.createAgent.mock.results[0]?.value;
    await service.resetChannel(scope);
    await service.handleSession(session("b"));
    const secondRuntime = state.createAgent.mock.results[1]?.value;

    expect(state.operations).toEqual(["interrupt", "stop", "storage.clear", "assets.clear"]);
    expect(secondRuntime).not.toBe(firstRuntime);
  });

  it("clears storage and assets without constructing a runtime", async () => {
    const ctx = createContext();
    const platform = createTestPlatformService({ ctx: ctx as never });
    vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
      state.operations.push("assets.clear");
    });
    const service = new YesImBotService(ctx, config);

    await service.resetChannel(scope);

    expect(state.createAgent).not.toHaveBeenCalled();
    expect(state.operations).toEqual(["storage.clear", "assets.clear"]);
  });

  it("waits for earlier preparation before reset and a later message", async () => {
    const ctx = createContext();
    const platform = createTestPlatformService({ ctx: ctx as never });
    const entered = createDeferred();
    const release = createDeferred();
    vi.spyOn(platform, "clearChannel").mockImplementation(async () => {
      state.operations.push("assets.clear");
    });
    platform.register({
      id: "test",
      platform: "test",
      async prepare({ message }) {
        if (message.messageId === "a") {
          state.operations.push("prepare:a:start");
          entered.resolve();
          await release.promise;
          state.operations.push("prepare:a:end");
        }
        if (message.messageId === "b") state.operations.push("prepare:b");
        return message.elements;
      },
    });
    const service = new YesImBotService(ctx, config);

    const first = service.handleSession(session("a"));
    await entered.promise;
    const reset = service.resetChannel(scope);
    const later = service.handleSession(session("b"));
    expect(state.operations).toEqual(["prepare:a:start"]);

    release.resolve();
    await Promise.all([first, reset, later]);

    expect(state.operations).toEqual([
      "prepare:a:start",
      "prepare:a:end",
      "interrupt",
      "stop",
      "storage.clear",
      "assets.clear",
      "prepare:b",
    ]);
  });
});
