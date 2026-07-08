import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    object: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    description: vi.fn<() => unknown>().mockReturnThis(),
  });

  mocks.schema.object.mockImplementation(chain);

  return {
    Context: class Context {},
    Logger: class Logger {},
    Schema: mocks.schema,
  };
});

import OnebotUtilsPlugin from "../src/index";

function createLogger() {
  return {
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
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
      registerAgentPlugin: vi.fn((factory: (context: never) => AgentPlugin) => {
        factories.push(factory);
        return dispose;
      }),
    },
  };

  return { ctx, dispose, factories };
}

function createChannelContext(overrides: Record<string, unknown> = {}) {
  return {
    channel: {
      platform: "onebot",
      selfId: "bot",
      channelId: "group",
      type: "group",
    },
    platform: {
      name: "onebot",
      unsafeBot: undefined,
    },
    ...overrides,
  };
}

async function getTools(plugin: AgentPlugin): Promise<AgentTool[]> {
  if (!plugin.tools) {
    return [];
  }

  return typeof plugin.tools === "function"
    ? ((await plugin.tools({} as never)) ?? [])
    : plugin.tools;
}

describe("onebot-utils plugin", () => {
  it("registers exactly one factory and disposes it on stop", async () => {
    const { ctx, dispose } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledOnce();

    await plugin.stop();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("returns no tools for non-OneBot channels", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!({
      channel: {
        platform: "discord",
        selfId: "bot",
        channelId: "channel",
        type: "group",
      },
      platform: {
        name: "discord",
      },
    } as never);

    expect(await getTools(runtimePlugin)).toEqual([]);
  });

  it("exposes only the migrated OneBot tools", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!(createChannelContext() as never);
    const tools = await getTools(runtimePlugin);

    expect(tools.map((tool) => tool.name)).toEqual([
      "onebot_get_forward_message",
      "onebot_create_reaction",
      "onebot_set_essence",
    ]);
  });

  it("fails forward-message calls when OneBot internals are unavailable", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!(createChannelContext() as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_get_forward_message");

    await expect(tool?.execute?.({ messageId: "forward-id" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 协议内部接口",
    );
  });

  it("fetches forward messages through unsafe bot internals", async () => {
    const getForwardMsg = vi.fn(async () => [{ message_id: 1 }]);
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!({
      ...createChannelContext(),
      platform: {
        name: "onebot",
        unsafeBot: {
          internal: {
            getForwardMsg,
          },
        },
      },
    } as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_get_forward_message");

    await expect(tool?.execute?.({ messageId: "forward-id" }, {} as never)).resolves.toEqual([
      { message_id: 1 },
    ]);
    expect(getForwardMsg).toHaveBeenCalledWith("forward-id");
  });

  it("fails reaction calls when OneBot request capability is unavailable", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!({
      ...createChannelContext(),
      platform: {
        name: "onebot",
        unsafeBot: {
          internal: {},
        },
      },
    } as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_create_reaction");

    await expect(
      tool?.execute?.({ messageId: "message-id", emojiId: "128077" }, {} as never),
    ).rejects.toThrow("当前频道适配器不支持 OneBot 请求接口");
  });

  it("creates reactions through unsafe bot request internals", async () => {
    const request = vi.fn(async () => ({ status: "ok" }));
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!({
      ...createChannelContext(),
      platform: {
        name: "onebot",
        unsafeBot: {
          internal: {
            _request: request,
          },
        },
      },
    } as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_create_reaction");

    await expect(
      tool?.execute?.({ messageId: "message-id", emojiId: "128077" }, {} as never),
    ).resolves.toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledWith("set_msg_emoji_like", {
      message_id: "message-id",
      emoji_id: "128077",
    });
  });

  it("fails essence calls when OneBot internals are unavailable", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!(createChannelContext() as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_set_essence");

    await expect(tool?.execute?.({ messageId: "message-id" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 协议内部接口",
    );
  });

  it("sets essence through unsafe bot internals", async () => {
    const setEssenceMsg = vi.fn(async () => undefined);
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = factories[0]!({
      ...createChannelContext(),
      platform: {
        name: "onebot",
        unsafeBot: {
          internal: {
            setEssenceMsg,
          },
        },
      },
    } as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_set_essence");

    await expect(tool?.execute?.({ messageId: "message-id" }, {} as never)).resolves.toEqual({
      success: true,
    });
    expect(setEssenceMsg).toHaveBeenCalledWith("message-id");
  });
});
