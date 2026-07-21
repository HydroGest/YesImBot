import { Context } from "@koishijs/core";
import { describe, expect, it, vi } from "vitest";

import { createTestPlatformService } from "./platform-service-helper.js";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeMocks = vi.hoisted(() => ({
  createAgent: vi.fn(() => ({
    id: "runtime_1",
    channel: {
      emit: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    },
    storage: {} as never,
    state: {} as never,
    init: vi.fn(),
    stop: vi.fn(async () => undefined),
    append: vi.fn(async () => undefined),
    send: vi.fn(() => "turn_1"),
    run: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "turn.queued", turnId: "turn_1" };
        yield { type: "turn.done", turnId: "turn_1" };
      },
    })),
    wait: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    setTools: vi.fn(),
    getModel: vi.fn(),
    setModel: vi.fn(),
    clear: vi.fn(async () => undefined),
    getActiveTurnId: vi.fn(() => undefined),
    isIdle: vi.fn(() => true),
  })),
}));

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();
  return {
    ...actual,
    createAgent: runtimeMocks.createAgent,
  };
});

import type { Config } from "../src/config.js";
import { YesImBotService } from "../src/runtime/service.js";
import type { ChannelAgentContext } from "../src/shared/types.js";

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

describe("channel agent context", () => {
  it("captures the raw Koishi bot from the first channel session", async () => {
    const ctx = createContext();
    createTestPlatformService({ ctx: ctx as never });
    const service = new YesImBotService(ctx, config);
    const unsafeBot = { selfId: "bot", internal: { protocol: "onebot" } };
    let seen: ChannelAgentContext | undefined;

    service.registerAgentPlugin((context) => {
      seen = context;
      return { name: "observer" };
    });

    await service.handleSession({
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      userId: "user",
      content: "ordinary message",
      bot: unsafeBot,
      send: vi.fn(async () => ["m1"]),
    } as never);

    expect(seen?.channel).toEqual({
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      type: "group",
    });
    expect(seen?.platform.name).toBe("onebot");
    expect(seen?.platform.unsafeBot).toBe(unsafeBot);
    expect(runtimeMocks.createAgent).toHaveBeenCalledTimes(1);
    const createAgentConfig = runtimeMocks.createAgent.mock.calls[0]?.[0];
    expect(createAgentConfig).toHaveProperty("terminalTool", true);
    expect(createAgentConfig).not.toHaveProperty("platform");
    expect(createAgentConfig).not.toHaveProperty("unsafeBot");
    expect(createAgentConfig).not.toHaveProperty("bot");
  });
});
