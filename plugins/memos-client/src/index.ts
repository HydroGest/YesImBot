import type { AgentMessage, AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { Schema, Universal, type Context, type Logger } from "koishi";
import { isEvent, type Event } from "koishi-plugin-yesimbot";

import { MemosCloudClient } from "./client.js";
import { memosConfigSchema } from "./config.js";
import { deriveMemosIdentity } from "./identity.js";
import { formatMemosPrompt } from "./prompt.js";
import { createAddMessageTool } from "./tools/core/add-message.js";
import {
  createDebugSearchChannelMemoryTool,
  createSearchMessageTool,
} from "./tools/core/search-message.js";
import type { MemosChannelType, MemosClientConfig } from "./types.js";

function captureMessageEvent(
  message: AgentMessage,
  assign: (snapshot: {
    authorId: string;
    messageId: string;
    channelType: MemosChannelType;
  }) => void,
): void {
  if (!isEvent(message) || !isMessageEvent(message)) {
    return;
  }

  assign({
    authorId: message.data.user.id!,
    messageId: message.data.message.id!,
    channelType: message.data.channel.type === Universal.Channel.Type.DIRECT ? "private" : "group",
  });
}

function isMessageEvent(event: Event): event is Event<"message"> {
  return event.data.type === "message";
}

export default class MemosClientPlugin {
  static name = "yesimbot-memos-client";
  static usage = "";
  static inject = ["yesimbot"];
  static Config: Schema<MemosClientConfig> = memosConfigSchema;

  public readonly ctx: Context;
  public readonly config: MemosClientConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: MemosClientConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.memos-client");
    this.ctx.on("ready", this.start.bind(this));
    this.ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;

    if (!this.config.apiKey) {
      this.logger.warn("MemOS client plugin disabled: apiKey is required.");
      return;
    }

    const client = new MemosCloudClient({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      post: this.ctx.http.post.bind(this.ctx.http),
    });

    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((channelContext) => {
      let latestAuthorId = "";
      let latestMessageId: string | undefined;
      let latestChannelType: MemosChannelType = "group";

      const resolveIdentity = (
        turnId: string,
        target?: { channelId?: string; channelType?: MemosChannelType },
      ) =>
        deriveMemosIdentity({
          channelScope: {
            platform: channelContext.channel.platform,
            selfId: channelContext.channel.selfId,
            channelId: target?.channelId ?? channelContext.channel.channelId,
          },
          channelType: target?.channelType ?? latestChannelType,
          authorId: latestAuthorId,
          messageId: latestMessageId,
          turnId,
          memoryScope: this.config.memoryScope,
          includeRawIdentityInfo: this.config.includeRawIdentityInfo,
        });

      const tools: AgentTool[] = [
        createSearchMessageTool({
          client,
          config: this.config,
          resolveIdentity,
          logger: this.logger,
        }),
        createAddMessageTool({
          client,
          config: this.config,
          resolveIdentity,
          now: () => new Date(),
          logger: this.logger,
        }),
      ];

      if (this.config.enableDebugTools) {
        tools.push(
          createDebugSearchChannelMemoryTool({
            client,
            config: this.config,
            resolveIdentity,
            logger: this.logger,
          }),
        );
      }

      return {
        name: "memos-client",
        tools,
        onAppend(entries) {
          for (const entry of entries) {
            if (entry.type !== "message") {
              continue;
            }

            captureMessageEvent(entry.data, ({ authorId, messageId, channelType }) => {
              latestAuthorId = authorId;
              latestMessageId = messageId;
              latestChannelType = channelType;
            });
          }

          return entries;
        },
        toModelMessages(message) {
          captureMessageEvent(message, ({ authorId, messageId, channelType }) => {
            latestAuthorId = authorId;
            latestMessageId = messageId;
            latestChannelType = channelType;
          });
          return undefined;
        },
        appendSystemPrompt: async () => {
          return formatMemosPrompt();
        },
      } satisfies AgentPlugin;
    });
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
