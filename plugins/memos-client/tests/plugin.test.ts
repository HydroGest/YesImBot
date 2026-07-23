import { createHash } from "node:crypto";

import type { AgentPlugin, AgentToolExecuteContext } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

import type { MemosClientConfig } from "../src/types.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function mockChannelKey(scope: {
  platform: string;
  selfId: string;
  channelId: string;
  isDirect: boolean;
}): string {
  const canonical = scope.isDirect
    ? ["yesimbot.channel", 1, "direct", scope.platform, scope.selfId, scope.channelId]
    : ["yesimbot.channel", 1, "shared", scope.platform, null, scope.channelId];
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest();
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of digest.subarray(0, 16)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

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
    Universal: { Channel: { Type: { DIRECT: 1 } } },
  };
});

vi.mock("koishi-plugin-yesimbot", () => ({
  isEvent(message: unknown) {
    return (
      typeof message === "object" &&
      message !== null &&
      (message as { role?: unknown }).role === "custom" &&
      (message as { type?: unknown }).type === "yesimbot.event"
    );
  },
}));

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
      channelKey:
        vi.fn<
          (scope: {
            platform: string;
            selfId: string;
            channelId: string;
            isDirect: boolean;
          }) => string
        >(mockChannelKey),
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
      isDirect: false,
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
        isDirect: false,
      },
      channelHash: "63up33lwnwsbbvzkgalypu3dvq",
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

  it("updates identity from message Events appended before model projection", async () => {
    const { ctx, factories, post } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, config);

    await plugin.start();

    const runtimePlugin = factories[0]!(channelContext() as never);
    const messageEvent = {
      role: "custom",
      type: "yesimbot.event",
      id: "event-message",
      timestamp: Date.now(),
      data: {
        type: "message",
        platform: "onebot",
        selfId: "bot-raw",
        channel: { id: "group-raw", type: "group" },
        user: { id: "author-raw", name: "Ada" },
        message: { id: "message-raw" },
        content: "hello",
      },
    };
    await runtimePlugin.onAppend?.(
      [
        {
          id: "entry-message-event",
          type: "message",
          timestamp: messageEvent.timestamp,
          data: messageEvent,
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
    const groupIdentity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "group-raw",
        isDirect: false,
      },
      channelHash: "ol3rc4aeenbqa4z4ob5dtnd5du",
      channelType: "group",
      authorId: "author-raw",
      messageId: "message-raw",
      turnId: "turn-real",
      memoryScope: "auto",
      includeRawIdentityInfo: false,
    });
    expect(body.user_id).toBe(groupIdentity.userId);
    expect(body.conversation_id).toBe(groupIdentity.conversationId);
    expect(body.info.turn_id).toBe("turn-real");
    expect(body.info.subject_hash).toBe(groupIdentity.info.subject_hash);
    expect(body.info.channel_hash).toBe(groupIdentity.info.channel_hash);
    expect(body.info.author_hash).toBe(groupIdentity.info.author_hash);
    expect(body.info.message_hash).toBe(groupIdentity.info.message_hash);
    expect(JSON.stringify(body.info)).not.toContain("author-raw");
    expect(JSON.stringify(body.info)).not.toContain("group-raw");
    expect(JSON.stringify(body.info)).not.toContain("bot-raw");
    expect(JSON.stringify(body.info)).not.toContain("message-raw");

    const directMessageEvent = {
      ...messageEvent,
      data: {
        ...messageEvent.data,
        channel: { id: "direct-raw", type: 1 },
        user: { id: "direct-author" },
        message: { id: "direct-message" },
      },
    };
    await runtimePlugin.toModelMessages?.(directMessageEvent as never, {} as never);
    await addTool?.execute?.({ content: "私聊偏好" }, toolContext("turn-direct"));

    const directIdentity = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "group-raw",
        isDirect: false,
      },
      channelHash: "ol3rc4aeenbqa4z4ob5dtnd5du",
      channelType: "private",
      authorId: "direct-author",
      messageId: "direct-message",
      turnId: "turn-direct",
      memoryScope: "auto",
      includeRawIdentityInfo: false,
    });
    const directBody = post.mock.calls[1]?.[1] as { user_id: string; conversation_id: string };
    expect(directBody).toMatchObject({
      user_id: directIdentity.userId,
      conversation_id: directIdentity.conversationId,
    });
  });

  it("does not update identity for delivery failures or non-Events", async () => {
    const { ctx, factories, post } = createContext();
    const plugin = new MemosClientPlugin(ctx as never, config);

    await plugin.start();

    const runtimePlugin = factories[0]!(channelContext() as never);
    const messageEvent = {
      role: "custom",
      type: "yesimbot.event",
      id: "event-message",
      timestamp: Date.now(),
      data: {
        type: "message",
        platform: "onebot",
        selfId: "bot-raw",
        channel: { id: "group-raw", type: "group" },
        user: { id: "author-raw" },
        message: { id: "message-raw" },
      },
    };
    await runtimePlugin.onAppend?.(
      [
        {
          id: "entry-message-event",
          type: "message",
          timestamp: messageEvent.timestamp,
          data: messageEvent,
        },
      ],
      {} as never,
    );
    await runtimePlugin.toModelMessages?.(
      {
        ...messageEvent,
        data: {
          type: "delivery.failed",
          platform: "onebot",
          selfId: "bot-raw",
          channel: { id: "group-raw", type: "group" },
          delivery: {
            turnId: "turn-failed",
            messageId: "assistant-message",
            error: { name: "Error", message: "offline" },
          },
        },
      } as never,
      {} as never,
    );
    await runtimePlugin.toModelMessages?.(
      { role: "user", id: "user-message", timestamp: Date.now(), content: "ignored" } as never,
      {} as never,
    );

    const addTool = (await getTools(runtimePlugin)).find((tool) => tool.name === "add_message");
    await addTool?.execute?.({ content: "仍归属原作者" }, toolContext("turn-real"));

    const expected = deriveMemosIdentity({
      channelScope: {
        platform: "onebot",
        selfId: "bot-raw",
        channelId: "group-raw",
        isDirect: false,
      },
      channelHash: "ol3rc4aeenbqa4z4ob5dtnd5du",
      channelType: "group",
      authorId: "author-raw",
      messageId: "message-raw",
      turnId: "turn-real",
      memoryScope: "auto",
      includeRawIdentityInfo: false,
    });
    const body = post.mock.calls[0]?.[1] as {
      user_id: string;
      conversation_id: string;
      info: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      user_id: expected.userId,
      conversation_id: expected.conversationId,
    });
    expect(body.info.author_hash).toBe(expected.info.author_hash);
    expect(body.info.message_hash).toBe(expected.info.message_hash);
  });
});
