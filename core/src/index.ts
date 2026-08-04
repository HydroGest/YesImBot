import { resolve } from "node:path";

import { Bot, Context, Service } from "koishi";

import { ArtifactService } from "./artifact.js";
import { AssetService } from "./asset.js";
import { registerSessionCommands } from "./commands/session.js";
import { Config } from "./config.js";
import { deliverOutput } from "./delivery.js";
import { Gateway, type PlatformTranslator } from "./gateway/index.js";
import { createOneBotTranslator } from "./gateway/onebot.js";
import type { EventMap, EventRecord } from "./messages.js";
import { ModelService } from "./model/index.js";
import { RuntimeManager, type ChannelPluginFactory } from "./runtime/index.js";
import { ensureDefaultPersona } from "./runtime/prompt.js";
import type { ResourceSchemeOpenHandler } from "./runtime/read.js";
import { ChannelScope, ChannelStorage } from "./runtime/storage.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export default class YesImBotService extends Service<Config> {
  public static readonly name = "yesimbot";
  public static readonly usage = ``;
  public static readonly inject = ["database"];
  public static readonly Config = Config;

  public readonly model: ModelService;
  public readonly assets: AssetService;
  private readonly storage: ChannelStorage;
  private readonly rt: RuntimeManager;
  private readonly gate: Gateway;
  private readonly channelPlugins = new Set<ChannelPluginFactory>();
  private readonly commandDisposers = new Set<() => unknown>();
  private readonly resourceSchemeRegistrations = new Map<string, { prompt: string; open: ResourceSchemeOpenHandler }>();
  private triggerClosed = false;
  private readonly triggerTasks = new Set<Promise<void>>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot");
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
    this.model = new ModelService(ctx, {
      basePath: config.basePath,
      logLevel: config.logLevel,
    });
    this.storage = new ChannelStorage(ctx, { basePath: config.basePath || ctx.baseDir });
    this.assets = new AssetService(this.storage);
    const artifacts = new ArtifactService(this.storage);
    this.rt = new RuntimeManager(
      ctx,
      this.model,
      this.assets,
      artifacts,
      this.storage,
      config,
      this.channelPlugins,
      this.resourceSchemeRegistrations,
    );
    this.gate = new Gateway(
      ctx,
      {
        allowedChannels: config.allowedChannels,
        pacing: { ...config.reply.pacing },
        logLevel: config.logLevel ?? 2,
      },
      {
        assets: this.assets,
        runtime: this.rt,
        ready: () => this.storage.start(),
      },
    );

    this.commandDisposers.add(registerSessionCommands(ctx, this.rt, { authority: 4 }));
  }

  public registerTranslator(translator: PlatformTranslator): () => void {
    return this.gate.registerTranslator(translator);
  }

  public registerChannelPlugin(resolver: ChannelPluginFactory): () => void {
    this.channelPlugins.add(resolver);
    return () => this.channelPlugins.delete(resolver);
  }

  public registerResourceScheme(scheme: string, prompt: string, open: ResourceSchemeOpenHandler): () => void {
    if (scheme === "asset" || scheme === "artifact") {
      throw new Error(`Scheme "${scheme}" is reserved`);
    }
    if (this.resourceSchemeRegistrations.has(scheme)) {
      throw new Error(`Scheme "${scheme}" is already registered`);
    }
    this.resourceSchemeRegistrations.set(scheme, { prompt, open });
    return () => {
      this.resourceSchemeRegistrations.delete(scheme);
    };
  }

  public getStoragePath(scope: ChannelScope): Promise<string> {
    return this.storage.getStoragePath(scope);
  }

  public override async start(): Promise<void> {
    await this.storage.start();
    await ensureDefaultPersona(resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir));
    const translators = [createOneBotTranslator];
    for (const createTranslator of translators) {
      const dispose = this.registerTranslator(createTranslator(this.ctx));
      this.ctx.on("dispose", dispose);
    }
  }

  public async reset(scope: ChannelScope): Promise<void> {
    return this.rt.reset(scope);
  }

  public async trigger<K extends keyof EventMap>(event: EventRecord<K>): Promise<void> {
    if (this.triggerClosed) return;
    const bot = this.ctx.bots.find(
      (candidate) => candidate.platform === event.platform && candidate.selfId === event.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${event.platform}:${event.selfId}`);

    const task = this.runTrigger(event, bot);
    this.triggerTasks.add(task);
    try {
      await task;
    } finally {
      this.triggerTasks.delete(task);
    }
  }

  private async runTrigger<K extends keyof EventMap>(event: EventRecord<K>, bot: Bot): Promise<void> {
    const result = await this.rt.trigger(event);
    if (result.kind !== "run") return;
    await deliverOutput({
      record: event,
      result,
      pacing: this.config.reply.pacing,
      send: (segment) => bot.sendMessage(event.channel.id, segment),
      warn: (cause) => this.logError("warn", "delivery.failed", cause),
    });
  }

  public override async stop() {
    this.disposeCommand();
    this.triggerClosed = true;
    try {
      this.gate.close();
    } catch (cause) {
      this.logError("warn", "gateway.failed.close", cause);
    }
    try {
      await this.rt.stop();
    } catch (cause) {
      this.logError("warn", "runtime.failed.stop", cause);
    }
    try {
      await this.drainTriggers();
    } catch (cause) {
      this.logError("warn", "trigger.failed.drain", cause);
    }
    try {
      await this.gate.drain();
    } catch (cause) {
      this.logError("warn", "gateway.failed.drain", cause);
    }
  }

  private async drainTriggers(): Promise<void> {
    await Promise.allSettled([...this.triggerTasks]);
  }

  private disposeCommand(): void {
    for (const dispose of this.commandDisposers) {
      try {
        dispose();
      } catch (cause) {
        this.logError("warn", "command.failed.dispose", cause);
      }
    }
    this.commandDisposers.clear();
  }

  private logError(level: "debug" | "info" | "warn" | "error", event: string, cause: unknown): void {
    try {
      this.logger[level]({ event, cause: cause instanceof Error ? cause.message : String(cause) });
    } catch {}
  }
}

export type { ArtifactStore, ArtifactWriter } from "./artifact.js";
export type { AssetService, AssetStore } from "./asset.js";
export type { PlatformTranslator } from "./gateway/types.js";
export * from "./messages.js";
export * from "./model/index.js";
export type { ChannelPluginFactory, ChannelPluginContext } from "./runtime/index.js";
export type { ResourceOpenResult, ResourceReadResult, ResourceSchemeOpenHandler } from "./runtime/read.js";
export type { ChannelScope } from "./runtime/storage.js";
