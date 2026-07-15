import type { AgentPlugin, AgentToolExecuteContext } from "@yesimbot/agent-runtime";
import { createChannelScopeId } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

import type { MemosClientConfig } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  schema: {
    array: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    const: vi.fn<() => unknown>(),
    number: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    string: vi.fn<() => unknown>(),
    union: vi.fn<() => unknown>(),
  },
}));

vi.mock("koishi", () => {
  const chain = () => ({
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
    required: vi.fn<() => unknown>().mockReturnThis(),
    role: vi.fn<() => unknown>().mockReturnThis(),
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

import { deriveMemosIdentity } from "../src/identity.js";
import MemosClientPlugin from "../src/index.js";

const config: MemosClientConfig = {
  baseUrl: "https://memos.example/api",
  apiKey: "mpg-secret",
  memoryScope: "auto",
  timeoutMs: 1000,
  searchMemoryLimit: 3,
  searchPreferenceLimit: 2,
  searchRelativity: 0.67,
  includePreference: true,
  searchFilterMode: "context",
  searchTags: ["yesimbot"],
  searchImportSources: [],
  asyncMode: true,
  tags: ["yesimbot"],
  includeRawIdentityInfo: false,
  enableDebugTools: false,
};

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
  const post = vi.fn<() => Promise<{ code: number; data: { task_id: string }; message: string }>>(
    async () => ({ code: 0, data: { task_id: "task-1" }, message: "ok" }),
  );
  const ctx = {
    http: { post },
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

  return { ctx, dispose, factories, post, scopedLogger };
}

function channelContext() {
  return {
    channel: {
      platform: "onebot",
      selfId: "bot-raw",
      channelId: "group-raw",
      type: "group",
    },
    platform: {
      name: "onebot",
      unsafeBot: undefined,
    },
  };
}

function toolContext(turnId = "turn-real"): AgentToolExecuteContext {
  return {
    runtime: { id: "runtime" },
    channel: {} as never,
    state: {} as never,
    storage: {} as never,
    turnId,
    toolCallId: "tool-call",
  };
}

async function getTools(plugin: AgentPlugin) {
  return typeof plugin.tools === "function"
    ? ((await plugin.tools({} as never)) ?? [])
    : (plugin.tools ?? []);
}

describe("MemosClientPlugin", () => {
  it("declines to register tools without an API key", async () => {
    const { ctx, scopedLogger } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, { ...config, apiKey: "" });

    await plugin.start();

    expect(ctx.yesimbot.registerAgentPlugin).not.toHaveBeenCalled();
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      "MemOS client plugin disabled: apiKey is required.",
    );
  });

  it("registers exactly search_message and add_message and extends prompt policy", async () => {
    const { ctx, factories, dispose } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, config);

    await plugin.start();

    expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledOnce();
    const runtimePlugin = factories[0]!(channelContext() as never);
    const tools = await getTools(runtimePlugin);

    expect(tools.map((tool) => tool.name)).toEqual(["search_message", "add_message"]);
    expect(tools.map((tool) => tool.name)).not.toContain("get_memory");
    expect(tools.map((tool) => tool.name)).not.toContain("delete_memory");
    const prompt = await runtimePlugin.appendSystemPrompt?.({} as never);
    const promptText = Array.isArray(prompt) ? prompt.join("\n") : String(prompt ?? "");
    expect(promptText).toContain("search_message");
    expect(promptText).toContain("same-subject");
    expect(promptText).toContain("same-context");
    expect(promptText).toContain("Imported historical memories");
    expect(promptText).toContain("Do not generalize one group member's statement");
    expect(promptText).toContain("add_message");
    expect(promptText).toContain("finalize_response({})");
    expect(promptText).not.toContain("mpg-secret");

    await plugin.stop();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("registers debug cross-channel search only when explicitly enabled", async () => {
    const { ctx, factories, post } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, { ...config, enableDebugTools: true });

    await plugin.start();

    const runtimePlugin = factories[0]!(channelContext() as never);
    const tools = await getTools(runtimePlugin);
    const debugTool = tools.find((tool) => tool.name === "debug_search_channel_memory");

    expect(tools.map((tool) => tool.name)).toEqual([
      "search_message",
      "add_message",
      "debug_search_channel_memory",
    ]);
    expect(debugTool).toBeDefined();

    await debugTool?.execute?.(
      { query: "历史约定", channelId: "other-group" },
      toolContext("turn-real"),
    );

    const expectedIdentity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "other-group",
      },
      channelType: "group",
      authorId: "",
      turnId: "turn-real",
      memoryScope: "auto",
      includeRawIdentityInfo: false,
    });
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.user_id).toBe(expectedIdentity.userId);
    expect(body.query).toBe("历史约定");
    expect(body).not.toHaveProperty("conversation_id");
  });

  it("captures latest platform message from onAppend after an earlier plugin converts it", async () => {
    const { ctx, factories, post } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, config);

    await plugin.start();

    const runtimePlugin = factories[0]!(channelContext() as never);
    const platformMessage = {
      role: "custom",
      type: "athena.platform.message",
      id: "platform-message",
      timestamp: Date.now(),
      data: {
        version: 1,
        source: {
          platform: "onebot",
          selfId: "bot-raw",
          channelId: "group-raw",
          conversationType: "group",
        },
        author: { id: "author-raw", name: "Ada" },
        message: {
          messageId: "message-raw",
          content: "hello",
          timestamp: Date.now(),
        },
      },
    };
    const earlierPlugin = {
      toModelMessages(message: typeof platformMessage) {
        if (message.role !== "custom" || message.type !== "athena.platform.message") {
          return undefined;
        }
        return [{ role: "user" as const, content: "[Ada]: hello" }];
      },
    };

    expect(await earlierPlugin.toModelMessages(platformMessage)).toEqual([
      { role: "user", content: "[Ada]: hello" },
    ]);
    await runtimePlugin.onAppend?.(
      [
        {
          id: "entry-platform-message",
          type: "message",
          timestamp: platformMessage.timestamp,
          data: platformMessage,
        },
      ],
      {} as never,
    );
    const addTool = (await getTools(runtimePlugin)).find((tool) => tool.name === "add_message");

    await addTool?.execute?.({ content: "Ada 偏好简洁回答。" }, toolContext("turn-real"));

    const body = post.mock.calls[0]?.[1] as {
      user_id: string;
      conversation_id: string;
      info: Record<string, unknown>;
    };
    expect(body.user_id).toMatch(/^yb_subject_[A-Za-z0-9_-]{22}$/);
    expect(body.conversation_id).toMatch(/^yb_conv_[A-Za-z0-9_-]{22}$/);
    expect(body.conversation_id).not.toBe(
      `yb_conv_${createChannelScopeId({
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "group-raw",
      })}`,
    );
    expect(body.info.turn_id).toBe("turn-real");
    expect(body.info.subject_hash).toEqual(expect.any(String));
    expect(body.info.channel_hash).toBe(
      createChannelScopeId({
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "group-raw",
      }),
    );
    expect(body.info.author_hash).toEqual(expect.any(String));
    expect(body.info.message_hash).toEqual(expect.any(String));
    expect(JSON.stringify(body.info)).not.toContain("author-raw");
    expect(JSON.stringify(body.info)).not.toContain("group-raw");
    expect(JSON.stringify(body.info)).not.toContain("bot-raw");
    expect(JSON.stringify(body.info)).not.toContain("message-raw");
  });
});
