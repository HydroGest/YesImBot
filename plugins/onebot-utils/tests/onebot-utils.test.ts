import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import type { ChannelPluginFactory, ChannelPluginContext } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  schema: {
    array: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    const: vi.fn<() => unknown>(),
    number: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    union: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
    min: vi.fn<() => unknown>().mockReturnThis(),
    role: vi.fn<() => unknown>().mockReturnThis(),
  });

  mocks.schema.array.mockImplementation(chain);
  mocks.schema.boolean.mockImplementation(chain);
  mocks.schema.const.mockImplementation(chain);
  mocks.schema.number.mockImplementation(chain);
  mocks.schema.object.mockImplementation(chain);
  mocks.schema.union.mockImplementation(chain);

  return {
    Context: class Context {},
    Logger: class Logger {},
    Schema: mocks.schema,
    h: vi.fn((type: string, attrs: Record<string, unknown> = {}, children: unknown[] = []) => ({
      type,
      attrs,
      children,
    })),
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
  const factories: ChannelPluginFactory[] = [];
  const dispose = vi.fn<() => void>();
  const ctx = {
    logger: rootLogger,
    on: vi.fn<(event: string, handler: () => unknown) => void>(),
    yesimbot: {
      registerChannelPlugin: vi.fn((factory: ChannelPluginFactory) => {
        factories.push(factory);
        return dispose;
      }),
    },
  };

  return { ctx, dispose, factories };
}

function createChannelScope(overrides: Record<string, unknown> = {}) {
  return {
    type: "shared",
    platform: "onebot",
    selfId: "bot",
    channelId: "group",
    ...overrides,
  };
}

async function getTools(plugin: AgentPlugin): Promise<AgentTool[]> {
  if (!plugin.tools) return [];
  return typeof plugin.tools === "function" ? ((await plugin.tools({} as never)) ?? []) : plugin.tools;
}

const DEFAULT_ENABLED_TOOLS = ["onebot_get_forward_message", "onebot_create_reaction", "onebot_set_essence"];

async function createRuntime(
  bot: unknown,
  config: Record<string, unknown> = {},
): Promise<{ getForwardTool: () => AgentTool; getTools: () => Promise<AgentTool[]> }> {
  const { ctx, factories } = createContext();
  const plugin = new OnebotUtilsPlugin(ctx as never, { enabledTools: DEFAULT_ENABLED_TOOLS, ...config } as never);
  await plugin.start();
  const runtimePlugin = await factories[0]!({ scope: createChannelScope(), bot } as never);
  const tools = await getTools(runtimePlugin);

  return {
    getForwardTool: () => tools.find((tool) => tool.name === "onebot_get_forward_message")!,
    getTools: async () => tools,
  };
}

const message = (segments: unknown[], overrides: Record<string, unknown> = {}) => ({
  sender: { user_id: 1, nickname: "Alice", card: "" },
  time: 1_753_888_000,
  message: segments,
  raw_message: "[CQ:ignored]",
  ...overrides,
});

describe("onebot-utils plugin", () => {
  it("registers exactly one factory and disposes it on stop", async () => {
    const { ctx, dispose } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});

    await plugin.start();
    await plugin.stop();

    expect(ctx.yesimbot.registerChannelPlugin).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("declares the enabled-tool configuration fields", () => {
    const fields = mocks.schema.object.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(Object.keys(fields)).toEqual(["enabledTools", "parseImages", "attachImageSummary", "maxForwardPageChars"]);
    expect(mocks.schema.array).toHaveBeenCalledOnce();
    expect(mocks.schema.union).toHaveBeenCalledOnce();
    expect(mocks.schema.const).toHaveBeenCalledTimes(9);
    expect(mocks.schema.boolean).toHaveBeenCalledTimes(2);
    expect(mocks.schema.number).toHaveBeenCalledOnce();
  });

  it("returns null for non-OneBot channels", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(ctx as never, {});
    await plugin.start();

    await expect(
      factories[0]!({ scope: { platform: "discord", selfId: "bot", channelId: "channel" } } as never),
    ).resolves.toBeNull();
  });

  it("exposes the migrated OneBot tools", async () => {
    const { ctx, factories } = createContext();
    const plugin = new OnebotUtilsPlugin(
      ctx as never,
      {
        enabledTools: [
          "onebot_get_forward_message",
          "onebot_create_reaction",
          "onebot_set_essence",
          "onebot_ban_user",
          "onebot_unban_user",
          "onebot_kick_user",
          "onebot_ocr_image",
          "onebot_set_qq_profile",
          "onebot_set_qq_avatar",
        ],
      } as never,
    );
    await plugin.start();

    const runtimePlugin = await factories[0]!({ scope: createChannelScope() } as never);
    const tools = await getTools(runtimePlugin);

    const names = tools.map((tool) => tool.name);

    expect(names).toHaveLength(9);
    expect(names).toEqual(
      expect.arrayContaining([
        "onebot_get_forward_message",
        "onebot_create_reaction",
        "onebot_set_essence",
        "onebot_ban_user",
        "onebot_unban_user",
        "onebot_kick_user",
        "onebot_ocr_image",
        "onebot_set_qq_profile",
        "onebot_set_qq_avatar",
      ]),
    );
  });

  it("fails forward requests when OneBot internals are unavailable", async () => {
    const runtime = await createRuntime({});

    await expect(runtime.getForwardTool().execute?.({ forwardId: "forward" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 协议内部接口",
    );
  });

  it("returns compact default forward pages and documents continuation", async () => {
    const getForwardMsg = vi.fn(async () => [
      message([
        { type: "text", data: { text: "hello" } },
        { type: "image", data: { summary: "cover", file: "cover.jpg", file_size: "1000" } },
      ]),
    ]);
    const runtime = await createRuntime({ internal: { getForwardMsg } });
    const tool = runtime.getForwardTool();

    await expect(tool.execute?.({ forwardId: "forward" }, {} as never)).resolves.toEqual({
      messages: [["Alice (1)", expect.any(String), ["hello[图片]"]]],
    });
    expect(tool.description).toContain("nextOffset");
    expect(tool.description).toContain("tips");
    expect(tool.description).toContain("forwardId");
    expect(tool.description).not.toContain("messageId");
  });

  it("changes only image parts when image parsing is enabled", async () => {
    const getForwardMsg = vi.fn(async () => [
      message([
        { type: "text", data: { text: "before" } },
        { type: "image", data: { summary: "cover", file: "cover.jpg", file_size: "1000" } },
        { type: "text", data: { text: "after" } },
      ]),
    ]);
    const runtime = await createRuntime(
      { internal: { getForwardMsg } },
      { parseImages: true, maxForwardPageChars: 6000 },
    );

    await expect(runtime.getForwardTool().execute?.({ forwardId: "forward" }, {} as never)).resolves.toEqual({
      messages: [["Alice (1)", expect.any(String), ["before", { image: ["cover", "cover.jpg", "1.0 KB"] }, "after"]]],
    });
  });

  it("returns nested forward IDs without inlining child messages", async () => {
    const runtime = await createRuntime({
      internal: {
        getForwardMsg: vi.fn(async () => [
          message([
            {
              type: "forward",
              data: {
                id: "child",
                content: [message([{ type: "text", data: { text: "hidden" } }])],
              },
            },
          ]),
        ]),
      },
    });

    await expect(runtime.getForwardTool().execute?.({ forwardId: "forward" }, {} as never)).resolves.toEqual({
      messages: [["Alice (1)", expect.any(String), [{ forward: "child" }]]],
    });
  });

  it("reuses one runtime-scoped forward reader across pages", async () => {
    const getForwardMsg = vi.fn(async () => [
      message([{ type: "text", data: { text: "a".repeat(3500) } }]),
      message([{ type: "text", data: { text: "b".repeat(3500) } }]),
    ]);
    const runtime = await createRuntime({ internal: { getForwardMsg } });
    const tool = runtime.getForwardTool();

    await tool.execute?.({ forwardId: "forward" }, {} as never);
    await tool.execute?.({ forwardId: "forward", offset: 1 }, {} as never);

    expect(getForwardMsg).toHaveBeenCalledOnce();
  });

  it("fails reaction calls when OneBot request capability is unavailable", async () => {
    const runtime = await createRuntime({ internal: {} });
    const tool = (await runtime.getTools()).find((item) => item.name === "onebot_create_reaction")!;

    await expect(tool.execute?.({ messageId: "message-id", emojiId: "128077" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 请求接口",
    );
  });

  it("creates reactions through OneBot request internals", async () => {
    const request = vi.fn(async () => ({ status: "ok" }));
    const runtime = await createRuntime({ internal: { _request: request } });
    const tool = (await runtime.getTools()).find((item) => item.name === "onebot_create_reaction")!;

    await expect(tool.execute?.({ messageId: "message-id", emojiId: "128077" }, {} as never)).resolves.toEqual({
      status: "ok",
    });
  });

  it("fails essence calls when OneBot internals are unavailable", async () => {
    const runtime = await createRuntime({});
    const tool = (await runtime.getTools()).find((item) => item.name === "onebot_set_essence")!;

    await expect(tool.execute?.({ messageId: "message-id" }, {} as never)).rejects.toThrow(
      "当前频道适配器不支持 OneBot 协议内部接口",
    );
  });

  it("sets essence through OneBot internals", async () => {
    const setEssenceMsg = vi.fn(async () => undefined);
    const runtime = await createRuntime({ internal: { setEssenceMsg } });
    const tool = (await runtime.getTools()).find((item) => item.name === "onebot_set_essence")!;

    await expect(tool.execute?.({ messageId: "message-id" }, {} as never)).resolves.toEqual({
      success: true,
    });
  });

  it("hides group management tools unless selected", async () => {
    const runtime = await createRuntime({ internal: { _request: vi.fn() } });
    const names = (await runtime.getTools()).map((tool) => tool.name);

    expect(names).not.toContain("onebot_ban_user");
    expect(names).not.toContain("onebot_unban_user");
    expect(names).not.toContain("onebot_kick_user");
  });

  it("bans and unbans through OneBot request internals", async () => {
    const request = vi.fn(async () => ({ status: "ok" }));
    const runtime = await createRuntime(
      { internal: { _request: request } },
      { enabledTools: ["onebot_ban_user", "onebot_unban_user"] },
    );
    const tools = await runtime.getTools();
    const banTool = tools.find((tool) => tool.name === "onebot_ban_user")!;
    const unbanTool = tools.find((tool) => tool.name === "onebot_unban_user")!;

    await expect(banTool.execute?.({ userId: "123", duration: 60 }, {} as never)).resolves.toEqual({
      success: true,
    });
    await expect(unbanTool.execute?.({ userId: "123" }, {} as never)).resolves.toEqual({
      success: true,
    });

    expect(request).toHaveBeenNthCalledWith(1, "set_group_ban", {
      group_id: Number("group"),
      user_id: 123,
      duration: 60,
    });
    expect(request).toHaveBeenNthCalledWith(2, "set_group_ban", {
      group_id: Number("group"),
      user_id: 123,
      duration: 0,
    });
  });

  it("kicks members through OneBot request internals", async () => {
    const request = vi.fn(async () => ({ status: "ok" }));
    const runtime = await createRuntime({ internal: { _request: request } }, { enabledTools: ["onebot_kick_user"] });
    const tool = (await runtime.getTools()).find((item) => item.name === "onebot_kick_user")!;

    await expect(tool.execute?.({ userId: "123", rejectAddRequest: true }, {} as never)).resolves.toEqual({
      success: true,
    });
    expect(request).toHaveBeenCalledWith("set_group_kick", {
      group_id: Number("group"),
      user_id: 123,
      reject_add_request: true,
    });
  });
});
