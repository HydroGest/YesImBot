import { resolve } from "node:path";

import { Command, Service, type Context } from "koishi";

import { AssetService } from "./asset.js";
import { ChannelStorage, type ChannelScope } from "./channel.js";
import { type Config } from "./config.js";
import { Gateway, type SessionResolver } from "./gateway.js";
import type { ModelService } from "./model/index.js";
import { createOnebotResolver } from "./platforms/index.js";
import { RuntimeManager, type AgentPluginFactory } from "./runtime/index.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model", "database"];

  readonly model: ModelService;
  readonly assets: AssetService;
  private readonly storage: ChannelStorage;
  private readonly rt: RuntimeManager;
  private readonly gate: Gateway;
  private readonly plugins = new Set<{ readonly factory: AgentPluginFactory }>();
  private readonly commandDisposers = new Set<() => unknown>();

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

  registerResolver(resolver: SessionResolver): () => void {
    return this.gate.register(resolver);
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    const registration = { factory };
    this.plugins.add(registration);
    return () => this.plugins.delete(registration);
  }

  getStoragePath(scope: ChannelScope): Promise<string> {
    return this.storage.getStoragePath(scope);
  }

  override async start(): Promise<void> {
    await this.storage.start();
    const resolvers = [createOnebotResolver];
    for (const createResolver of resolvers) {
      const dispose = this.registerResolver(createResolver(this.ctx));
      this.ctx.on("dispose", dispose);
    }
  }

  async reset(scope: ChannelScope): Promise<void> {
    return this.rt.reset(scope);
  }

  override async stop() {
    this.disposeCommand();
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
      await this.gate.drain();
    } catch (cause) {
      this.logError("warn", "gateway.failed.drain", cause);
    }
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
