import { type AgentPlugin, type AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot } from "koishi";
import type { OneBot, OneBotBot } from "koishi-plugin-adapter-onebot";
import type { AgentPluginFactory, ChannelScope } from "koishi-plugin-yesimbot";

import { createForwardReader } from "./forward.js";
import type { ForwardPage, ForwardReaderConfig, ForwardToolInput } from "./types.js";

export interface OnebotUtilsConfig {
  parseImages: boolean;
  maxForwardPageChars: number;
}

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

function getOneBotInternal(bot: Bot): OneBot.Internal {
  const internal = (bot as unknown as OneBotBot<Context>).internal;
  if (!internal) throw new Error(ONEBOT_INTERNAL_UNAVAILABLE_ERROR);
  return internal;
}

function createOneBotTools(bot: Bot, config: Readonly<ForwardReaderConfig>): AgentTool[] {
  let forwardReader: ReturnType<typeof createForwardReader> | undefined;

  const getForwardMessageTool: AgentTool<ForwardToolInput, ForwardPage> = {
    name: "onebot_get_forward_message",
    description:
      "分页获取合并转发消息的紧凑元组。若结果含 nextOffset，请使用相同 messageId 和该 nextOffset 继续读取；嵌套转发仅返回子转发 ID。",
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

  return [getForwardMessageTool, createReactionTool, setEssenceTool];
}

function createOneBotPluginFactory(config: OnebotUtilsConfig): AgentPluginFactory {
  return async (scope: ChannelScope, bot: Bot) => {
    if (scope.platform !== "onebot") return null;

    const forwardConfig = Object.freeze({
      parseImages: config.parseImages,
      maxForwardPageChars: config.maxForwardPageChars,
    });
    return {
      name: "onebot-utils",
      tools: createOneBotTools(bot, forwardConfig),
    } satisfies AgentPlugin;
  };
}

export default class OnebotUtilsPlugin {
  static name = "yesimbot-onebot-utils";
  static inject = ["yesimbot"];
  static usage = "OneBot 工具插件，提供获取合并转发消息、表态和设置精华等功能";
  static Config: Schema<OnebotUtilsConfig> = Schema.object({
    parseImages: Schema.boolean().default(false).description("解析转发消息中的图片元数据"),
    maxForwardPageChars: Schema.number()
      .min(1)
      .default(6000)
      .description("合并转发消息每页的最大文本字符数"),
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

  async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin(
      createOneBotPluginFactory(this.config),
    );
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
