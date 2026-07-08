import { Context } from "@koishijs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

const runtimeMocks = vi.hoisted(() => {
  const state = {
    appendError: undefined as Error | undefined,
    waitTurnResult: undefined as
      | { turnId: string; status: "done"; messages: [] }
      | { turnId: string; status: "failed"; messages: []; error: { message: string } }
      | undefined,
  };

  return {
    state,
    reset() {
      state.appendError = undefined;
      state.waitTurnResult = undefined;
    },
  };
});

vi.mock("@yesimbot/agent-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yesimbot/agent-runtime")>();

  return {
    ...actual,
    createAgent: vi.fn(() => ({
      id: "runtime_1",
      channel: {
        emit() {},
        subscribe: vi.fn(() => () => undefined),
      },
      storage: {} as never,
      state: {} as never,
      init: vi.fn(),
      stop: vi.fn(async () => undefined),
      append: vi.fn(async () => {
        if (runtimeMocks.state.appendError) {
          throw runtimeMocks.state.appendError;
        }
      }),
      send: vi.fn(() => "turn_1"),
      run: vi.fn(),
      waitTurn: vi.fn(async () => {
        return runtimeMocks.state.waitTurnResult ?? { turnId: "turn_1", status: "done", messages: [] };
      }),
      interrupt: vi.fn(async () => undefined),
      setTools: vi.fn(),
      getModel: vi.fn(),
    })),
  };
});

import { type Config } from "../src/config.js";
import { YesImBotService } from "../src/service.js";

const config: Config = {
  basePath: "data/yesimbot-core",
  chatModel: "mock:model",
  logLevel: 2,
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

function createService() {
  const service = new YesImBotService(createContext(), config);
  vi.spyOn(service.logger, "error").mockImplementation(() => undefined);
  return service;
}

describe("error handling", () => {
  beforeEach(() => {
    runtimeMocks.reset();
  });

  it("logs ordinary group append failures without sending a proactive reply", async () => {
    runtimeMocks.state.appendError = new Error("append failed");
    const service = createService();
    const session = {
      platform: "discord",
      selfId: "bot",
      channelId: "group",
      userId: "user",
      content: "ordinary message",
      send: vi.fn(async () => undefined),
    };

    await service.handleSession(session as never);

    expect(service.logger.error).toHaveBeenCalled();
    expect(session.send).not.toHaveBeenCalled();
  });

  it.each([
    { label: "direct", session: { subtype: "private", isDirect: true, content: "hello" } },
    { label: "mention", session: { content: '<at id="bot"/> hello' } },
  ])(
    "logs and sends a generic error reply when $label turn processing fails",
    async ({ session: overrides }) => {
      runtimeMocks.state.waitTurnResult = {
        turnId: "turn_1",
        status: "failed",
        messages: [],
        error: { message: "turn failed" },
      };
      const service = createService();
      const session = {
        platform: "discord",
        selfId: "bot",
        channelId: "room",
        userId: "user",
        content: "hello",
        send: vi.fn(async () => undefined),
        ...overrides,
      };

      await service.handleSession(session as never);

      expect(service.logger.error).toHaveBeenCalled();
      expect(session.send).toHaveBeenCalledWith(expect.stringMatching(/error/i));
    },
  );
});
