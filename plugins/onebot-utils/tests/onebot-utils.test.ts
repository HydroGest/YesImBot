import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import type { AgentPluginFactory } from "koishi-plugin-yesimbot";
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
  const factories: Array<AgentPluginFactory & ((context: any) => ReturnType<AgentPluginFactory>)> =
    [];
  const dispose = vi.fn<() => void>();
  const ctx = {
    logger: rootLogger,
    on: vi.fn<(event: string, handler: () => unknown) => void>(),
    yesimbot: {
      registerAgentPlugin: vi.fn((factory: AgentPluginFactory) => {
        factories.push(
          Object.assign(
            (context: { channel?: unknown; bot?: unknown }) =>
              factory((context.channel ?? context) as never, context.bot as never),
            { requiresMessageId: factory.requiresMessageId },
          ),
        );
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
    },
    bot: {},
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

interface ForwardResult {
  forwardId: string;
  offset: number;
  messages: Array<{ sender: string; time?: string; content: string }>;
  hasMore: boolean;
}

async function executeForward(
  raw: unknown,
  input: { offset?: number; limit?: number } = {},
): Promise<ForwardResult> {
  const getForwardMsg = vi.fn(async () => raw);
  const { ctx, factories } = createContext();
  const plugin = new OnebotUtilsPlugin(ctx as never, {});
  await plugin.start();

  const runtimePlugin = await factories[0]!({
    ...createChannelContext(),
    bot: { internal: { getForwardMsg } },
  } as never);
  const tools = await getTools(runtimePlugin);
  const tool = tools.find((item) => item.name === "onebot_get_forward_message");

  return tool?.execute?.(
    { messageId: "forward-id", ...input },
    {} as never,
  ) as Promise<ForwardResult>;
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

    const runtimePlugin = await factories[0]!({
      channel: {
        platform: "discord",
        selfId: "bot",
        channelId: "channel",
      },
      bot: {},
    } as never);

    expect(runtimePlugin).toBeNull();
  });

  it("exposes only the migrated OneBot tools", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    expect(factories[0]?.requiresMessageId).toBe(true);

    const runtimePlugin = await factories[0]!(createChannelContext() as never);
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

    const runtimePlugin = await factories[0]!(createChannelContext() as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_get_forward_message");

    await expect(tool?.execute?.({ messageId: "forward-id" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 协议内部接口",
    );
  });

  it("fetches forward messages through unsafe bot internals with pagination", async () => {
    const getForwardMsg = vi.fn(async () => [
      { sender: { user_id: 1, nickname: "Alice" }, time: 1700000000, raw_message: "hello" },
    ]);
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = await factories[0]!({
      ...createChannelContext(),
      bot: {
        internal: {
          getForwardMsg,
        },
      },
    } as never);
    const tools = await getTools(runtimePlugin);
    const tool = tools.find((item) => item.name === "onebot_get_forward_message");

    const result = await tool?.execute?.({ messageId: "forward-id" }, {} as never);

    expect(result).toMatchObject({
      forwardId: "forward-id",
      offset: 0,
      hasMore: false,
    });
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages[0]).toMatchObject({
      sender: expect.stringContaining("Alice"),
      content: "hello",
    });
    expect(result.messages[0]).not.toHaveProperty("message_id");
    expect(getForwardMsg).toHaveBeenCalledWith("forward-id");
  });

  it("normalizes structured segments without stringifying objects", async () => {
    const result = await executeForward([
      {
        sender: { user_id: 1, card: "Alice" },
        raw_message: "",
        message: [
          { type: "text", data: { text: "hello " } },
          { type: "image", data: { url: "https://example.com/image.png" } },
          { type: "text", data: { text: " world" } },
          { type: "file", data: { name: "secret.txt" } },
        ],
      },
    ]);

    expect(result.messages[0]?.content).toBe("hello [图片] world[文件]");
    expect(JSON.stringify(result)).not.toContain("[object Object]");
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("normalizes string-valued message content when raw_message is unavailable", async () => {
    const result = await executeForward([
      {
        sender: { user_id: 1, card: "Alice" },
        message: "hello [CQ:image,file=private.png]",
      },
    ]);

    expect(result.messages[0]?.content).toBe("hello [图片]");
  });

  it("drops malformed and unknown forward objects without leaking their data", async () => {
    const result = await executeForward([
      {
        sender: { user_id: { valueOf: () => "leaked-user" } },
        message_id: "child-id",
        raw_message: { secret: "raw-secret" },
        message: [
          { type: "record", data: {} },
          { type: "video", data: {} },
          { type: "unknown", data: { text: "secret" } },
          { type: "text", data: { text: { valueOf: () => "leaked-text" } } },
          { type: "image", data: "malformed" },
          null,
        ],
      },
    ]);

    expect(result.messages[0]).toEqual({ sender: "unknown", content: "[语音][视频]" });
    expect(JSON.stringify(result)).not.toMatch(/child-id|raw-secret|leaked-/);
  });

  it("sanitizes raw CQ media, URLs, asset IDs, and unsupported CQ syntax", async () => {
    const assetId = `asset_${"a".repeat(64)}`;
    const result = await executeForward([
      {
        sender: { user_id: 1, nickname: "Alice" },
        raw_message: `look [CQ:image,url=https://example.com/a] https://example.com/b ${assetId} [CQ:at,qq=2]`,
      },
    ]);

    expect(result.messages[0]?.content).toBe("look [图片] [链接]");
    expect(JSON.stringify(result)).not.toMatch(/https:\/\/|asset_|CQ:/);
  });

  it("enforces deterministic pagination and record and page content limits", async () => {
    const result = await executeForward(
      Array.from({ length: 25 }, (_, index) => ({
        message_id: `child-${index}`,
        sender: { user_id: index },
        raw_message: `${index}-`.padEnd(1_200, "x"),
      })),
      { offset: -3, limit: 99 },
    );

    expect(result.offset).toBe(0);
    expect(result.messages).toHaveLength(6);
    expect(result.messages.every((message) => message.content.length <= 1_000)).toBe(true);
    expect(
      result.messages.reduce((sum, message) => sum + message.content.length, 0),
    ).toBeLessThanOrEqual(6_000);
    expect(result.hasMore).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/message_id|child-/);
  });

  it("preserves offset pagination after the page content limit", async () => {
    const result = await executeForward(
      Array.from({ length: 8 }, (_, index) => ({
        sender: { user_id: index },
        raw_message: `${index}-`.padEnd(1_200, "x"),
      })),
      { offset: 6, limit: 10 },
    );

    expect(result.offset).toBe(6);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content.startsWith("6-")).toBe(true);
    expect(result.hasMore).toBe(false);
  });

  it("fails reaction calls when OneBot request capability is unavailable", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();

    const runtimePlugin = await factories[0]!({
      ...createChannelContext(),
      bot: {
        internal: {},
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

    const runtimePlugin = await factories[0]!({
      ...createChannelContext(),
      bot: {
        internal: {
          _request: request,
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

    const runtimePlugin = await factories[0]!(createChannelContext() as never);
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

    const runtimePlugin = await factories[0]!({
      ...createChannelContext(),
      bot: {
        internal: {
          setEssenceMsg,
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
