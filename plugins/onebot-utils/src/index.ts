import { type AgentPlugin, type AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import type { ForwardMessage, OneBotCapableBot, OneBotInternal } from "./types.js";

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
  },
  required: ["messageId"],
  additionalProperties: false,
}) as AgentTool<{ messageId: string }>["inputSchema"];

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

function createOneBotTools(unsafeBot: unknown): AgentTool[] {
  const getForwardMessageTool: AgentTool<{ messageId: string }, ForwardMessage[] | unknown> = {
    name: "onebot_get_forward_message",
    description: "获取合并转发消息的原始消息列表",
    inputSchema: FORWARD_MESSAGE_SCHEMA,
    execute: async ({ messageId }) => {
      const internal = getOneBotInternal(unsafeBot);
      return internal.getForwardMsg(messageId);
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
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((context) => {
      if (context.channel.platform !== "onebot") {
        return {
          name: "onebot-utils",
          tools: [],
        } satisfies AgentPlugin;
      }

      return {
        name: "onebot-utils",
        tools: createOneBotTools(context.platform.unsafeBot),
      } satisfies AgentPlugin;
    });
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
