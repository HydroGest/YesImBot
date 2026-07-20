import type { AgentCustomMessage, AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { Schema, type Context, type Logger } from "koishi";
import type {} from "koishi-plugin-yesimbot";

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

type CapturedPlatformMessage = AgentCustomMessage<"athena.platform.message">;

function isCapturedPlatformMessage(message: unknown): message is CapturedPlatformMessage {
  const candidate = message as Partial<CapturedPlatformMessage>;
  return candidate.role === "custom" && candidate.type === "athena.platform.message";
}

function capturePlatformMessage(
  message: unknown,
  assign: (snapshot: { authorId: string; messageId?: string }) => void,
): void {
  if (!isCapturedPlatformMessage(message)) {
    return;
  }

  assign({
    authorId: message.data.sender.id,
    messageId: message.data.messageId,
  });
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
          channelType: target?.channelType ?? (channelContext.channel.type as MemosChannelType),
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

            capturePlatformMessage(entry.data, ({ authorId, messageId }) => {
              latestAuthorId = authorId;
              latestMessageId = messageId;
            });
          }

          return entries;
        },
        toModelMessages(message) {
          capturePlatformMessage(message, ({ authorId, messageId }) => {
            latestAuthorId = authorId;
            latestMessageId = messageId;
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
