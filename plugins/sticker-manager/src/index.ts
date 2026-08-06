import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger } from "koishi";

import { ModelStickerClassifier } from "./classifier.js";
import { registerStickerCommands } from "./commands.js";
import { StickerConfigSchema } from "./config.js";
import { StickerFileStore } from "./files.js";
import { BotStickerSender } from "./sender.js";
import { projectStickerElements } from "./sticker-element.js";
import { registerStickerModel, StickerStore } from "./store.js";
import { createStickerTools } from "./tools.js";
import { scopeKeyFor, type StickerConfig } from "./types.js";

export default class StickerManagerPlugin {
  public static readonly name = "yesimbot-sticker-manager";
  public static readonly inject = ["yesimbot", "database"];
  public static readonly Config = StickerConfigSchema;
  public static readonly usage = "表情包收藏、分类、导入和管理插件";

  public readonly ctx: Context;
  public readonly config: StickerConfig;
  public readonly logger: Logger;
  public readonly store: StickerStore;

  private disposeAgentPlugin?: () => void;
  private disposeCommands?: () => void;
  private started = false;

  public constructor(ctx: Context, config: StickerConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.sticker-manager");
    const files = new StickerFileStore(ctx.baseDir, config.storagePath);
    registerStickerModel(ctx.model);
    this.store = new StickerStore(ctx.model, files);
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.store.ensure();
      const classifier = new ModelStickerClassifier(this.ctx, this.config);
      this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope, bot, artifacts }) => {
        const assets = this.ctx.yesimbot.assets.createStore(scope);
        return {
          name: "sticker-manager",
          tools: () =>
            createStickerTools({
              store: this.store,
              classifier,
              sender: new BotStickerSender(bot, scope),
              assets,
              scope,
              config: this.config,
            }),
          onAppend: (entries) =>
            projectStickerElements(entries, {
              store: this.store,
              artifacts,
              scopeKey: scopeKeyFor(scope, this.config),
              config: this.config,
            }),
          appendSystemPrompt: () => formatStickerPrompt(this.config),
        } satisfies AgentPlugin;
      });
      this.disposeCommands = registerStickerCommands({
        ctx: this.ctx,
        store: this.store,
        classifier,
        config: this.config,
      });
      this.logger.success("Sticker manager plugin started");
    } catch (cause) {
      this.started = false;
      this.stop().catch((stopCause) => this.logger.warn("sticker_plugin_stop_failed", { cause: stopCause }));
      throw cause;
    }
  }

  public async stop(): Promise<void> {
    this.started = false;
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    this.disposeCommands?.();
    this.disposeCommands = undefined;
    this.logger.info("Sticker manager plugin stopped");
  }
}

function formatStickerPrompt(config: StickerConfig): string {
  return [
    "表情包能力由当前插件提供：",
    "- sticker_categories 查询分类和数量；",
    "- sticker_search 搜索可用表情包；",
    "- sticker_steal 收藏当前消息中的图片；",
    "- sticker_send 发送指定或随机表情包。",
    ...(config.tagMode ? ["- sticker_tags 查询实验性标签；sticker_send 可传多个 tags 并按最匹配随机发送。"] : []),
    ...(config.stickerElement
      ? [
          '也可以直接输出 <sticker id="..."/>、<sticker category="..."/> 或 <sticker tags="可爱,猫"/> 发送表情，不需要调用 sticker_send。',
        ]
      : []),
    config.stickerElement ? "需要发图时可直接输出 <sticker/>，或调用 sticker_send。" : "需要发图时调用 sticker_send。",
    "不需要把返回的 id 当成可读内容发给用户。",
  ].join("\n");
}
