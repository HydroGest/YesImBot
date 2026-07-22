import { type AgentPlugin, type AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot } from "koishi";
import type { AgentPluginFactory, ChannelScope } from "koishi-plugin-yesimbot";

import type { OneBotCapableBot, OneBotInternal } from "./types.js";

export interface OnebotUtilsConfig {}

const ONEBOT_INTERNAL_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 协议内部接口";
const ONEBOT_REQUEST_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 请求接口";

const FORWARD_MESSAGE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "合并转发消息的 ID",
    },
    offset: {
      type: "integer",
      minimum: 0,
      description: "分页偏移，默认 0",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 20,
      description: "每页条数，默认 10，最大 20",
    },
  },
  required: ["messageId"],
  additionalProperties: false,
}) as AgentTool<{ messageId: string; offset?: number; limit?: number }>["inputSchema"];

const CREATE_REACTION_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "要表态的消息 ID",
    },
    emojiId: {
      type: "string",
      description: "表情 ID",
    },
  },
  required: ["messageId", "emojiId"],
  additionalProperties: false,
}) as AgentTool<{ messageId: string; emojiId: string }>["inputSchema"];

const SET_ESSENCE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    messageId: {
      type: "string",
      description: "要设置为精华的消息 ID",
    },
  },
  required: ["messageId"],
  additionalProperties: false,
}) as AgentTool<{ messageId: string }>["inputSchema"];

function getOneBotInternal(unsafeBot: unknown): OneBotInternal {
  const internal = (unsafeBot as OneBotCapableBot | undefined)?.internal;
  if (!internal) {
    throw new Error(ONEBOT_INTERNAL_UNAVAILABLE_ERROR);
  }
  return internal;
}

interface ForwardRecord {
  sender: string;
  time?: string;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = scalarString(value);
    if (text !== undefined) return text;
  }
  return undefined;
}

function sanitizeForwardSegments(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((segment) => {
      if (!isRecord(segment) || !isRecord(segment.data)) return "";
      switch (segment.type) {
        case "text":
          return typeof segment.data.text === "string" ? segment.data.text : "";
        case "image":
          return "[图片]";
        case "record":
          return "[语音]";
        case "video":
          return "[视频]";
        case "file":
          return "[文件]";
        default:
          return "";
      }
    })
    .join("");
}

function formatForwardTime(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value * 1000));
}

function sanitizeForwardRecords(raw: unknown): ForwardRecord[] {
  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.messages)
      ? raw.messages
      : [];

  return items.map((item): ForwardRecord => {
    const record = isRecord(item) ? item : {};
    const sender = isRecord(record.sender) ? record.sender : {};
    const displayName = firstNonEmpty(sender.card, sender.nickname);
    const userId = scalarString(sender.user_id);
    const senderName =
      displayName && userId && displayName !== userId
        ? `${displayName} (${userId})`
        : (displayName ?? userId ?? "unknown");
    const rawContent =
      typeof record.raw_message === "string" && record.raw_message.length > 0
        ? record.raw_message
        : typeof record.message === "string"
          ? record.message
          : sanitizeForwardSegments(record.message);
    const time = formatForwardTime(record.time);

    return {
      sender: senderName,
      ...(time ? { time } : {}),
      content: sanitizeForwardContent(rawContent),
    };
  });
}

function sanitizeForwardContent(raw: string): string {
  return raw
    .replace(/\[CQ:image,[^\]]*\]/gi, "[图片]")
    .replace(/\[CQ:record,[^\]]*\]/gi, "[语音]")
    .replace(/\[CQ:video,[^\]]*\]/gi, "[视频]")
    .replace(/\[CQ:file,[^\]]*\]/gi, "[文件]")
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/\basset_[a-f0-9]{64}\b/gi, "")
    .replace(/\[CQ:[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createOneBotTools(unsafeBot: unknown): AgentTool[] {
  const getForwardMessageTool: AgentTool<
    { messageId: string; offset?: number; limit?: number },
    {
      forwardId: string;
      offset: number;
      messages: Array<{ sender: string; time?: string; content: string }>;
      hasMore: boolean;
    }
  > = {
    name: "onebot_get_forward_message",
    description: "分页获取合并转发消息的详情",
    inputSchema: FORWARD_MESSAGE_SCHEMA,
    execute: async ({ messageId, offset = 0, limit = 10 }) => {
      const internal = getOneBotInternal(unsafeBot);
      const raw = await internal.getForwardMsg(messageId);
      const records = sanitizeForwardRecords(raw);
      const clampedLimit = Math.min(20, Math.max(1, limit ?? 10));
      const start = Math.max(0, offset ?? 0);
      const slice = records.slice(start, start + clampedLimit);

      const messages: Array<{ sender: string; time?: string; content: string }> = [];
      let totalChars = 0;
      for (const rec of slice) {
        let content = rec.content.length > 1000 ? rec.content.slice(0, 1000) : rec.content;
        if (totalChars + content.length > 6000) break;
        messages.push({ ...rec, content });
        totalChars += content.length;
      }

      return {
        forwardId: messageId,
        offset: start,
        messages,
        hasMore: start + messages.length < records.length,
      };
    },
  };

  const createReactionTool: AgentTool<{ messageId: string; emojiId: string }, unknown> = {
    name: "onebot_create_reaction",
    description: "对消息进行表态",
    inputSchema: CREATE_REACTION_SCHEMA,
    execute: async ({ messageId, emojiId }) => {
      const internal = getOneBotInternal(unsafeBot);
      if (!internal._request) {
        throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
      }
      return internal._request("set_msg_emoji_like", {
        message_id: messageId,
        emoji_id: emojiId,
      });
    },
  };

  const setEssenceTool: AgentTool<{ messageId: string }, { success: true }> = {
    name: "onebot_set_essence",
    description: "将消息设置为精华",
    inputSchema: SET_ESSENCE_SCHEMA,
    execute: async ({ messageId }) => {
      const internal = getOneBotInternal(unsafeBot);
      await internal.setEssenceMsg(messageId);
      return { success: true };
    },
  };

  return [getForwardMessageTool, createReactionTool, setEssenceTool];
}

const oneBotPluginFactory = Object.assign(
  async ({ channel, bot }: { readonly channel: ChannelScope; readonly bot: Bot }) => {
    if (channel.platform !== "onebot") return null;
    return {
      name: "onebot-utils",
      tools: createOneBotTools(bot),
    } satisfies AgentPlugin;
  },
  { requiresMessageId: true },
) satisfies AgentPluginFactory;

export default class OnebotUtilsPlugin {
  static name = "yesimbot-onebot-utils";
  static inject = ["yesimbot"];
  static usage = "OneBot 工具插件，提供获取合并转发消息、表态和设置精华等功能";
  static Config: Schema<OnebotUtilsConfig> = Schema.object({});

  public readonly ctx: Context;
  public readonly config: OnebotUtilsConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: OnebotUtilsConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.onebot-utils");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin(oneBotPluginFactory);
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
