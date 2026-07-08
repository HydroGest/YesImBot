import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    array: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    number: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    string: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
  });

  for (const key of Object.keys(mocks.schema) as Array<keyof typeof mocks.schema>) {
    mocks.schema[key].mockImplementation(chain);
  }

  return {
    Context: class Context {},
    Logger: class Logger {},
    Schema: mocks.schema,
  };
});

import ToolObserverPlugin from "../src/index.js";

function createLogger() {
  return {
    debug: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
  };
}

function createContext() {
  const scopedLogger = createLogger();
  const rootLogger = Object.assign(
    vi.fn<() => ReturnType<typeof createLogger>>(() => scopedLogger),
    createLogger(),
  );
  const factories: Array<(context: never) => AgentPlugin> = [];
  const dispose = vi.fn<() => void>();
  const ctx = {
    logger: rootLogger,
    on: vi.fn<(event: string, handler: () => unknown) => void>(),
    yesimbot: {
      registerAgentPlugin: vi.fn<(factory: (context: never) => AgentPlugin) => () => void>(
        (factory) => {
          factories.push(factory);
          return dispose;
        },
      ),
    },
  };

  return { ctx, dispose, factories, scopedLogger };
}

function channelContext(sendMessage = vi.fn<() => Promise<void>>(async () => undefined)) {
  return {
    channel: {
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      type: "group",
    },
    platform: {
      name: "onebot",
      unsafeBot: { sendMessage },
    },
  };
}

async function createRuntimePlugin(
  config: ConstructorParameters<typeof ToolObserverPlugin>[1] = {},
  sendMessage = vi.fn<() => Promise<void>>(async () => undefined),
) {
  const harness = createContext();
  const plugin = new ToolObserverPlugin(harness.ctx as never, config);

  await plugin.start();

  const runtimePlugin = harness.factories[0]!(channelContext(sendMessage) as never);
  return { ...harness, plugin, runtimePlugin, sendMessage };
}

describe("tool observer plugin", () => {
  it("registers and disposes an agent plugin factory", async () => {
    const { ctx, dispose } = createContext();
    const plugin = new ToolObserverPlugin(ctx as never, {});

    await plugin.start();

    expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledOnce();

    await plugin.stop();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("sends one notification after a successful non-ignored tool call", async () => {
    const { runtimePlugin, sendMessage } = await createRuntimePlugin({ displayMaxChars: 200 });

    await runtimePlugin.beforeToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: { query: "koishi" } },
      { turnId: "turn_1" } as never,
    );
    await runtimePlugin.afterToolCall?.(
      {
        toolCallId: "call_1",
        toolName: "web_search",
        args: { query: "koishi" },
        result: { items: [{ title: "Koishi" }] },
        isError: false,
      },
      { turnId: "turn_1" } as never,
    );

    expect(sendMessage).toHaveBeenCalledWith("group", expect.stringContaining("web_search"));
    const content = String(sendMessage.mock.calls[0]?.[1]);
    expect(content).toContain("status: success");
    expect(content).toContain("query: koishi");
    expect(content).toContain("items[1]");
  });

  it("does not return a before-tool decision that could override earlier plugins", async () => {
    const { runtimePlugin } = await createRuntimePlugin();

    expect(
      runtimePlugin.beforeToolCall?.(
        { toolCallId: "call_1", toolName: "web_search", args: { query: "original" } },
        {} as never,
      ),
    ).toBeUndefined();
  });

  it("records timing without retaining tool arguments", async () => {
    const { runtimePlugin, sendMessage } = await createRuntimePlugin({ displayArgs: true });

    await runtimePlugin.beforeToolCall?.(
      { toolCallId: "call_1", toolName: "web_search", args: { query: "original" } },
      {} as never,
    );
    await runtimePlugin.afterToolCall?.(
      {
        toolCallId: "call_1",
        toolName: "web_search",
        args: { query: "replaced" },
        result: { ok: true },
        isError: false,
      },
      { turnId: "turn_1" } as never,
    );

    const content = String(sendMessage.mock.calls[0]?.[1]);
    expect(content).toContain("query: replaced");
    expect(content).not.toContain("query: original");
  });

  it("sends one notification after a failed non-ignored tool call", async () => {
    const { runtimePlugin, sendMessage } = await createRuntimePlugin({ displayMaxChars: 200 });

    await runtimePlugin.afterToolCall?.(
      {
        toolCallId: "call_1",
        toolName: "web_search",
        args: { query: "koishi" },
        result: { name: "Error", message: "boom" },
        isError: true,
      },
      { turnId: "turn_1" } as never,
    );

    expect(sendMessage).toHaveBeenCalledWith("group", expect.stringContaining("web_search"));
    expect(String(sendMessage.mock.calls[0]?.[1])).toContain("status: error");
  });

  it("does not notify ignored tools including finalize_response by default", async () => {
    const { runtimePlugin, sendMessage } = await createRuntimePlugin();

    await runtimePlugin.afterToolCall?.(
      {
        toolCallId: "call_1",
        toolName: "finalize_response",
        args: {},
        result: { ok: true },
        isError: false,
      },
      { turnId: "turn_1" } as never,
    );

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("redacts and truncates notification previews", async () => {
    const { runtimePlugin, sendMessage } = await createRuntimePlugin({ displayMaxChars: 35 });

    await runtimePlugin.afterToolCall?.(
      {
        toolCallId: "call_1",
        toolName: "redact_tool",
        args: { token: "secret", keep: "abcdefghijklmnopqrstuvwxyz" },
        result: { ok: true },
        isError: false,
      },
      { turnId: "turn_1" } as never,
    );

    const content = String(sendMessage.mock.calls[0]?.[1]);
    expect(content).toContain("[redacted]");
    expect(content).toContain("[truncated]");
    expect(content).not.toContain("secret");
  });

  it("does not fail the hook when notification send fails", async () => {
    const sendMessage = vi.fn<() => Promise<void>>(async () => {
      throw new Error("send boom");
    });
    const { runtimePlugin, scopedLogger } = await createRuntimePlugin({}, sendMessage);

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_1",
          toolName: "web_search",
          args: {},
          result: { ok: true },
          isError: false,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toBeUndefined();
    expect(scopedLogger.warn).toHaveBeenCalledOnce();
  });

  it("does not rewrite tool results by default", async () => {
    const { runtimePlugin } = await createRuntimePlugin();

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_1",
          toolName: "web_search",
          args: {},
          result: { items: [{ title: "A" }] },
          isError: false,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toBeUndefined();
  });

  it("rewrites JSON-like successful results when compression is enabled", async () => {
    const { runtimePlugin } = await createRuntimePlugin({ compressJsonToolResults: true });

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_1",
          toolName: "web_search",
          args: {},
          result: { items: [{ title: "A" }] },
          isError: false,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toEqual({ result: expect.stringContaining("items[1]") });
  });

  it("does not rewrite failed, ignored, or non-JSON-like results", async () => {
    const { runtimePlugin } = await createRuntimePlugin({ compressJsonToolResults: true });

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_1",
          toolName: "web_search",
          args: {},
          result: "plain text",
          isError: false,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toBeUndefined();

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_2",
          toolName: "web_search",
          args: {},
          result: { name: "Error" },
          isError: true,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toBeUndefined();

    await expect(
      runtimePlugin.afterToolCall?.(
        {
          toolCallId: "call_3",
          toolName: "finalize_response",
          args: {},
          result: { ok: true },
          isError: false,
        },
        { turnId: "turn_1" } as never,
      ),
    ).resolves.toBeUndefined();
  });
});
