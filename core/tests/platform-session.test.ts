import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeMocks = vi.hoisted(() => {
  const state = { append: vi.fn() };
  return {
    state,
    reset() {
      state.append.mockReset();
      state.append.mockResolvedValue(undefined);
    },
  };
});

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: vi.fn(() => ({
      id: "runtime_1",
      channel: { emit() {}, subscribe: vi.fn(() => () => undefined) },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(),
      stop: vi.fn(async () => undefined),
      append: runtimeMocks.state.append,
      send: vi.fn(() => "turn_1"),
      run: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
      wait: vi.fn(async () => undefined),
      interrupt: vi.fn(async () => undefined),
      setTools: vi.fn(),
      getModel: vi.fn(),
      setModel: vi.fn(),
      clear: vi.fn(async () => undefined),
      getActiveTurnId: vi.fn(() => undefined),
      isIdle: vi.fn(() => true),
    })),
  };
});

vi.mock("../src/runtime/storage.js", () => ({
  createJsonlStorage: vi.fn(() => ({
    append: vi.fn(async () => undefined),
    read: vi.fn(async () => []),
    clear: vi.fn(async () => undefined),
  })),
}));

vi.mock("../src/channel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/channel.js")>();
  return {
    ...actual,
    ensureChannelScopeRecord: vi.fn(async () => undefined),
  };
});

import type { Config } from "../src/config.js";
import { YesImBotService } from "../src/runtime/service.js";
import { createTestPlatformService } from "./platform-service-helper.js";

const config: Config = {
  basePath: "data/yesimbot-core",
  chatModel: "mock:model",
  logLevel: 2,
};

function createContext() {
  const ctx = new Context();
  ctx.baseDir = "/tmp/athena";
  (
    ctx as Context & {
      "yesimbot.model": { resolveChatModel(): { model: { modelId: string } } };
    }
  )["yesimbot.model"] = {
    resolveChatModel() {
      return { model: { modelId: "mock:model" } };
    },
  };
  return ctx;
}

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    platform: "test",
    selfId: "bot",
    channelId: "room",
    userId: "user",
    content: "hello",
    timestamp: 1,
    event: {
      type: "message",
      message: { id: "m1", content: "hello", user: { id: "user" } },
      user: { id: "user" },
    },
    send: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as import("koishi").Session;
}

describe("platform session collection (simplified)", () => {
  beforeEach(() => runtimeMocks.reset());

  it("converts at internal/session and routes the same message in middleware", async () => {
    const ctx = createContext();
    const registry = createTestPlatformService({ now: () => 10, ctx: ctx as never });
    const refine = vi.fn(() => ({ kind: "keep" }) as const);
    registry.register({ id: "test", platform: "test", refine });
    const service = new YesImBotService(ctx as never, config);
    const session = createSession();

    ctx.emit(session as never, "internal/session", session as never);
    await service.handleSession(session as never);

    expect(refine).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.state.append).toHaveBeenCalledTimes(1);
  });

  it("notifies a collected event without routing it to a channel agent", () => {
    const ctx = createContext();
    const registry = createTestPlatformService({ now: () => 10, ctx: ctx as never });
    const listener = vi.fn();
    registry.subscribe(listener);
    const service = new YesImBotService(ctx as never, config);

    // An adapter that turns a session without channelId into an event
    registry.register({
      id: "event-adapter",
      platform: "test",
      refine: () => ({
        kind: "event",
        event: {
          source: { platform: "test", selfId: "bot" },
          scope: { type: "account" },
          type: "onebot.message-reactions-updated" as never,
          data: { messageId: "m1", reactions: [] } as never,
          content: "reactions updated",
        },
      }),
    });

    const session = createSession({
      event: {
        type: "notice",
        notice_type: "group_card",
      },
      channelId: undefined,
      content: undefined,
    });

    // Trigger collection directly via collectIfNeeded (the mock ctx.on does not register listeners)
    registry.collectIfNeeded(session);

    expect(listener).toHaveBeenCalledOnce();
    if (listener.mock.calls[0]) {
      const event = listener.mock.calls[0][0] as Record<string, unknown>;
      expect(event.type).toBe("onebot.message-reactions-updated");
    }
    expect(runtimeMocks.state.append).not.toHaveBeenCalled();
  });
});
