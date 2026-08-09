import type { AgentMessage, AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { Schema, Universal, type Bot, type Context, type Logger } from "koishi";
import { isMessage, type ChannelScope } from "koishi-plugin-yesimbot";

import { MemosCloudClient } from "./client.js";
import { memosConfigSchema } from "./config.js";
import { deriveMemosIdentity } from "./identity.js";
import { formatMemosPrompt } from "./prompt.js";
import { createAddMessageTool } from "./tools/core/add-message.js";
import { createSearchMessageTool } from "./tools/core/search-message.js";
import type { MemosChannelType, MemosClientConfig } from "./types.js";
export default class MemosClientPlugin {
  public static name = "yesimbot-memos-client";
  public static usage = "";
  public static inject = ["yesimbot"];
  public static Config: Schema<MemosClientConfig> = memosConfigSchema;

  public readonly ctx: Context;
  public readonly config: MemosClientConfig;
  public readonly logger: Logger;

  private client: MemosCloudClient | undefined;
  private disposeAgentPlugin?: () => void;

  public constructor(ctx: Context, config: MemosClientConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.memos-client");
    this.ctx.on("ready", this.start.bind(this));
    this.ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;

    if (!this.config.apiKey) {
      this.client = undefined;
      this.logger.warn("MemOS client plugin disabled: apiKey is required.");
      return;
    }

    this.client = new MemosCloudClient({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      timeoutMs: this.config.timeoutMs,
      post: this.ctx.http.post.bind(this.ctx.http),
    });
    this.disposeAgentPlugin = this.ctx.yesimbot.agent.use(this);
  }

  public async setup(scope: ChannelScope, _bot: Bot): Promise<AgentPlugin | null> {
    const client = this.client;
    if (!client) return null;
    let latestAuthorId = "";
    let latestMessageId: string | undefined;
    const resolveIdentity = (turnId: string) => {
      return deriveMemosIdentity({
        channelScope: scope,
        channelType: scope.type === "direct" ? "private" : "group",
        authorId: latestAuthorId,
        messageId: latestMessageId,
        turnId,
        memoryScope: this.config.memoryScope,
        includeRawIdentityInfo: this.config.includeRawIdentityInfo,
      });
    };

    const tools: AgentTool[] = [
      createSearchMessageTool({ client, config: this.config, resolveIdentity, logger: this.logger }),
      createAddMessageTool({ client, config: this.config, resolveIdentity, now: () => new Date(), logger: this.logger }),
    ];

    return {
      name: "memos-client",
      tools,
      onAppend(entries) {
        for (const entry of entries) {
          if (entry.type !== "message") continue;
          captureMessageEvent(entry.data, ({ authorId, messageId }) => {
            latestAuthorId = authorId;
            latestMessageId = messageId;
          });
        }
        return entries;
      },
      toModelMessages(message) {
        captureMessageEvent(message, ({ authorId, messageId }) => {
          latestAuthorId = authorId;
          latestMessageId = messageId;
        });
        return undefined;
      },
      appendSystemPrompt: () => formatMemosPrompt(),
    } satisfies AgentPlugin;
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
function captureMessageEvent(message: AgentMessage, assign: (snapshot: { authorId: string; messageId: string; channelType: MemosChannelType }) => void): void {
  if (!isMessage(message)) {
    return;
  }

  assign({
    authorId: message.data.user.id,
    messageId: message.data.messageId,
    channelType: message.data.channel.type === Universal.Channel.Type.DIRECT ? "private" : "group",
  });
}
