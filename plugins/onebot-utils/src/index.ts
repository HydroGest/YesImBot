import { type AgentPlugin, type AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot } from "koishi";
import type { OneBot, OneBotBot } from "koishi-plugin-adapter-onebot";
import type { ChannelPluginFactory, ChannelPluginContext } from "koishi-plugin-yesimbot";

import { createForwardReader } from "./forward.js";
import type { ForwardReaderConfig, ForwardResult, ForwardToolInput } from "./types.js";

const ONEBOT_INTERNAL_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 协议内部接口";
const ONEBOT_REQUEST_UNAVAILABLE_ERROR = "当前频道适配器不支持 OneBot 请求接口";

const FORWARD_MESSAGE_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    forwardId: {
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
      maximum: 60,
      description: "每页条数，默认 30，最大 60",
    },
  },
  required: ["forwardId"],
  additionalProperties: false,
}) as AgentTool<ForwardToolInput>["inputSchema"];

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

const BAN_USER_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "要禁言的用户 ID",
    },
    duration: {
      type: "integer",
      minimum: 0,
      default: 30,
      description: "禁言时长，单位秒；0 表示解除禁言",
    },
  },
  required: ["userId"],
  additionalProperties: false,
}) as AgentTool<{ userId: string; duration: number }>["inputSchema"];

const KICK_USER_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "要移出群的用户 ID",
    },
    rejectAddRequest: {
      type: "boolean",
      default: false,
      description: "是否拒绝该用户再次加群",
    },
  },
  required: ["userId"],
  additionalProperties: false,
}) as AgentTool<{ userId: string; rejectAddRequest?: boolean }>["inputSchema"];

const UNBAN_USER_SCHEMA = jsonSchema({
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "要解除禁言的用户 ID",
    },
  },
  required: ["userId"],
  additionalProperties: false,
}) as AgentTool<{ userId: string }>["inputSchema"];

export interface OnebotUtilsConfig {
  parseImages: boolean;
  maxForwardPageChars: number;
  banTools: boolean;
}

function getOneBotInternal(bot: Bot): OneBot.Internal {
  const internal = (bot as unknown as OneBotBot<Context>).internal;
  if (!internal) throw new Error(ONEBOT_INTERNAL_UNAVAILABLE_ERROR);
  return internal;
}

function createOneBotTools(
  bot: Bot,
  config: Readonly<ForwardReaderConfig>,
  banTools: boolean,
  groupId: string | null,
): AgentTool[] {
  let forwardReader: ReturnType<typeof createForwardReader> | undefined;

  const getForwardMessageTool: AgentTool<ForwardToolInput, ForwardResult> = {
    name: "onebot_get_forward_message",
    description:
      "分页获取合并转发消息的紧凑元组。使用 forwardId；若返回 tips，表示还有剩余内容，可按其中的 nextOffset 使用相同 forwardId 继续读取。",
    inputSchema: FORWARD_MESSAGE_SCHEMA,
    execute: async (input) => {
      forwardReader ??= createForwardReader(getOneBotInternal(bot), config);
      return forwardReader(input);
    },
  };

  const createReactionTool: AgentTool<{ messageId: string; emojiId: string }, unknown> = {
    name: "onebot_create_reaction",
    description: "对消息进行表态",
    inputSchema: CREATE_REACTION_SCHEMA,
    execute: async ({ messageId, emojiId }) => {
      const internal = getOneBotInternal(bot);
      if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
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
      await getOneBotInternal(bot).setEssenceMsg(messageId);
      return { success: true };
    },
  };

  const banUserTool: AgentTool<{ userId: string; duration: number }, { success: true } | { error: string }> = {
    name: "onebot_ban_user",
    description: "禁言当前群内的指定成员，duration 单位秒",
    inputSchema: BAN_USER_SCHEMA,
    execute: async ({ userId, duration }) => {
      try {
        if (!groupId) return { error: "当前频道不是群聊" };
        await requestOneBot(bot, "set_group_ban", {
          group_id: Number(groupId),
          user_id: toOneBotUserId(userId),
          duration: Math.max(0, Math.floor(duration)),
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const unbanUserTool: AgentTool<{ userId: string }, { success: true } | { error: string }> = {
    name: "onebot_unban_user",
    description: "解除当前群内指定成员的禁言",
    inputSchema: UNBAN_USER_SCHEMA,
    execute: async ({ userId }) => {
      try {
        if (!groupId) return { error: "当前频道不是群聊" };
        await requestOneBot(bot, "set_group_ban", {
          group_id: Number(groupId),
          user_id: toOneBotUserId(userId),
          duration: 0,
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const kickUserTool: AgentTool<
    { userId: string; rejectAddRequest?: boolean },
    { success: true } | { error: string }
  > = {
    name: "onebot_kick_user",
    description: "将指定成员移出当前群",
    inputSchema: KICK_USER_SCHEMA,
    execute: async ({ userId, rejectAddRequest }) => {
      try {
        if (!groupId) return { error: "当前频道不是群聊" };
        await requestOneBot(bot, "set_group_kick", {
          group_id: Number(groupId),
          user_id: toOneBotUserId(userId),
          reject_add_request: rejectAddRequest ?? false,
        });
        return { success: true };
      } catch (cause) {
        return { error: errorMessage(cause) };
      }
    },
  };

  const tools: AgentTool[] = [getForwardMessageTool, createReactionTool, setEssenceTool];
  if (banTools) tools.push(banUserTool, unbanUserTool, kickUserTool);
  return tools;
}

function requestOneBot(bot: Bot, action: string, params: Record<string, unknown>): Promise<unknown> {
  const internal = getOneBotInternal(bot);
  if (!internal._request) throw new Error(ONEBOT_REQUEST_UNAVAILABLE_ERROR);
  return internal._request(action, params);
}

function toOneBotUserId(userId: string): number {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`无效的用户 ID: ${userId}`);
  }
  return id;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function createOneBotPluginFactory(config: OnebotUtilsConfig): ChannelPluginFactory {
  return async ({ scope, bot }: ChannelPluginContext) => {
    if (scope.platform !== "onebot") return null;
    const groupId = scope.type === "shared" ? scope.channelId : null;

    const forwardConfig = Object.freeze({
      parseImages: config.parseImages,
      maxForwardPageChars: config.maxForwardPageChars,
    });
    return {
      name: "onebot-utils",
      tools: createOneBotTools(bot, forwardConfig, config.banTools, groupId),
    } satisfies AgentPlugin;
  };
}

export default class OnebotUtilsPlugin {
  public static name = "yesimbot-onebot-utils";
  public static inject = ["yesimbot"];
  public static usage = "OneBot 工具插件，提供获取合并转发消息、表态和设置精华等功能";
  public static Config: Schema<OnebotUtilsConfig> = Schema.object({
    banTools: Schema.boolean()
      .default(false)
      .description("启用禁言、解除禁言和移出群工具"),
    parseImages: Schema.boolean().default(false).description("解析转发消息中的图片元数据"),
    maxForwardPageChars: Schema.number().min(1).default(6000).description("合并转发消息每页的最大文本字符数"),
  });

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

  public async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(createOneBotPluginFactory(this.config));
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
