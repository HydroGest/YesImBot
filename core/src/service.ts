import { resolve } from "node:path";

import { Command, Service, type Bot, type Context } from "koishi";

import { AssetService } from "./asset.js";
import { ChannelStorage, type ChannelScope } from "./channel.js";
import { type Config } from "./config.js";
import { deliverOutput } from "./delivery.js";
import { Gateway, type PlatformTranslator } from "./gateway.js";
import type { EventMap, EventRecord } from "./messages.js";
import type { ModelService } from "./model/index.js";
import { createOnebotTranslator } from "./platforms/index.js";
import { RuntimeManager, type AgentPluginFactory } from "./runtime/index.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  public static readonly inject = ["yesimbot.model", "database"];

  public readonly model: ModelService;
  public readonly assets: AssetService;
  private readonly storage: ChannelStorage;
  private readonly rt: RuntimeManager;
  private readonly gate: Gateway;
  private readonly plugins = new Set<{ readonly factory: AgentPluginFactory }>();
  private readonly commandDisposers = new Set<() => unknown>();
  private triggerClosed = false;
  private readonly triggerTasks = new Set<Promise<void>>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
    this.model = ctx["yesimbot.model"];
    this.storage = new ChannelStorage(ctx, resolve(ctx.baseDir, config.basePath || ctx.baseDir));
    this.assets = new AssetService(this.storage);
    this.rt = new RuntimeManager({
      ctx,
      config,
      logger: this.logger,
      assets: this.assets,
      storage: this.storage,
      getAgentPluginFactories: () => [...this.plugins].map(({ factory }) => factory),
    });
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

    const resetCommand = ctx.command("yesimbot.reset", { authority: 4 });
    resetCommand.action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) return;
      await this.reset({
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId,
        type: session.isDirect ? "direct" : "shared",
      });
    });
    this.registerCommand(resetCommand);
  }

  public registerTranslator(translator: PlatformTranslator): () => void {
    return this.gate.registerTranslator(translator);
  }

  public registerAgentPlugin(factory: AgentPluginFactory): () => void {
    const registration = { factory };
    this.plugins.add(registration);
    return () => this.plugins.delete(registration);
  }

  public getStoragePath(scope: ChannelScope): Promise<string> {
    return this.storage.getStoragePath(scope);
  }

  public override async start(): Promise<void> {
    await this.storage.start();
    const translators = [createOnebotTranslator];
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

  private async runTrigger<K extends keyof EventMap>(
    event: EventRecord<K>,
    bot: Bot,
  ): Promise<void> {
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

  private registerCommand(command: Command): void {
    if (typeof command.dispose === "function") this.commandDisposers.add(() => command.dispose());
  }

  private logError(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    cause: unknown,
  ): void {
    try {
      this.logger[level]({ event, cause: cause instanceof Error ? cause.message : String(cause) });
    } catch {}
  }
}
