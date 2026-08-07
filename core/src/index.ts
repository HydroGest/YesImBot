import { resolve } from "node:path";

import { Bot, Context, Service } from "koishi";

import { Agents } from "./agents/index.js";
import { ArtifactService } from "./artifact.js";
import { AssetService } from "./asset.js";
import { registerSessionCommands } from "./commands/session.js";
import { Config } from "./config.js";
import { deliverOutput } from "./delivery.js";
import { Gateway } from "./gateway/index.js";
import { createOneBotTranslator } from "./gateway/onebot.js";
import type { PlatformTranslator } from "./gateway/types.js";
import type { EventMap, EventRecord } from "./messages/index.js";
import { ModelService } from "./models/index.js";
import { ensureAgentsFile, ensureDefaultPersona } from "./runtimes/prompt.js";
import { Runtimes } from "./runtimes/index.js";
import { Channels, type ChannelScope } from "./channels/index.js";
import type { ResourceReader } from "./resources/index.js";
import { ChannelStorage } from "./runtime/storage.js";

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
  private readonly channels: Channels;
  private readonly rt: Runtimes;
  private readonly gate: Gateway;
  public readonly agent: Agents;
  private readonly commandDisposers = new Set<() => unknown>();
  private readonly resourceSchemeRegistrations = new Map<string, ResourceReader>();
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
    this.storage = new ChannelStorage(ctx, { basePath: config.basePath || ctx.baseDir, logLevel: config.logLevel });
    this.channels = new Channels(ctx, { basePath: config.basePath || ctx.baseDir, logLevel: config.logLevel });
    this.assets = new AssetService(this.storage);
    this.agent = new Agents();
    this.rt = new Runtimes(ctx, this.channels, this.model, config, this.agent);
    this.gate = new Gateway(
      ctx,
      {
        allowedChannels: config.allowedChannels,
        pacing: { ...config.reply.pacing },
        logLevel: config.logLevel ?? 2,
      },
      {
        channels: this.channels,
        assets: this.assets,
        runtime: this.rt,
        ready: () => this.channels.start(),
      },
    );

    this.commandDisposers.add(registerSessionCommands(ctx, this.rt, { authority: 4 }));
  }

  public registerTranslator(translator: PlatformTranslator): () => void {
    return this.gate.registerTranslator(translator);
  }

  public registerResourceScheme(reader: ResourceReader): () => void {
    return this.channels.use(reader);
  }
  public async getStoragePath(scope: ChannelScope): Promise<string> {
    return (await this.channels.resolve(scope)).root;
  }

  public override async start(): Promise<void> {
    await this.channels.start();
    const promptBasePath = resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir);
    await ensureDefaultPersona(promptBasePath);
    await ensureAgentsFile(promptBasePath);
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
    const result = await this.rt.post(event, bot);
    if (result.kind !== "run") return;
    try {
      for await (const output of result.output) {
        for (const segment of output.segments) await bot.sendMessage(event.channel.id, segment);
      }
    } catch (cause) {
      const channel = await this.channels.resolve(event.channel.type === 1
        ? { type: "direct", platform: event.platform, selfId: event.selfId, channelId: event.channel.id }
        : { type: "shared", platform: event.platform, channelId: event.channel.id });
      await (await this.rt.get(channel, bot)).fail(result.eventId, cause);
      this.logError("warn", "delivery.failed", cause);
    }
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
export { persistElements } from "./gateway/resources.js";
export * from "./messages/index.js";
export * from "./models/index.js";
export { ChannelPlugin, type Will, WillPlugin } from "./agents/index.js";
