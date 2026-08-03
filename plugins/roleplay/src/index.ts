import { resolve } from "node:path";

import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { loadCharacterCard } from "./card.js";
import { selectGreeting } from "./greeting.js";
import { createRoleplayPlugin } from "./roleplay.js";

export interface RoleplayPluginConfig {
  characterCard: string;
  useRandomGreeting?: boolean;
}

export default class RoleplayPlugin {
  public static readonly name = "yesimbot-roleplay";
  public static readonly usage = "从 PNG 角色卡加载角色扮演提示词。";
  public static readonly inject = ["yesimbot"];
  public static readonly Config: Schema<RoleplayPluginConfig> = Schema.object({
    characterCard: Schema.path({ filters: ["file"] }).description("PNG 角色卡文件路径"),
    useRandomGreeting: Schema.boolean().default(false).description("随机选择角色卡开场白"),
  });

  public readonly ctx: Context;
  public readonly config: RoleplayPluginConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin: (() => void) | undefined;

  constructor(ctx: Context, config: RoleplayPluginConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.roleplay");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;

    const card = await loadCharacterCard(resolve(this.ctx.baseDir, this.config.characterCard));
    const greeting = selectGreeting(card, this.config.useRandomGreeting ?? false);
    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope }) =>
      createRoleplayPlugin({
        card,
        greeting,
        userName: scope.type === "direct" ? scope.channelId : "User",
      }),
    );
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}
