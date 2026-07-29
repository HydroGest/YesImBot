import { resolve } from "node:path";

import { Service, type Context } from "koishi";

import { createAssetService, type AssetService } from "./asset.js";
import { ChannelStorage, type ChannelScope } from "./channel.js";
import { resolveReplyPacingConfig, type Config } from "./config.js";
import { Gateway, type SessionResolver } from "./gateway.js";
import type { ModelService } from "./model/index.js";
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
  private stopTask: Promise<void> | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
    this.model = ctx["yesimbot.model"];
    this.storage = new ChannelStorage(
      resolve(ctx.baseDir, config.basePath || ctx.baseDir),
      (code, fields) => {
        this.logger.warn({ code, ...fields });
      },
    );
    this.assets = createAssetService(this.storage);
    this.rt = new RuntimeManager({
      ctx,
      config,
      logger: this.logger,
      assets: this.assets,
      storage: this.storage,
      getAgentPluginFactories: () => [...this.plugins].map(({ factory }) => factory),
    });
    this.gate = new Gateway({
      ctx,
      assets: this.assets,
      runtime: this.rt,
      ready: () => this.storage.start(),
      allowedChannels: config.allowedChannels ?? [],
      logger: this.logger,
      pacing: resolveReplyPacingConfig(config.reply?.pacing),
    });

    const resetCommand = ctx.command("yesimbot.reset", { authority: 4 });
    resetCommand.action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) return;
      await this.reset({
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId,
        isDirect: session.isDirect,
      });
    });
    this.registerCommandDisposer(resetCommand);

    const modalityCommand = ctx.command(
      "yesimbot.model.add-input-modality <model:string> <modality:string>",
      "",
      { authority: 4 },
    );
    modalityCommand.action(async (_, model, modality) => {
      try {
        const result = await this.model.addChatModelInputModality(model, modality);
        return `Input modality ${result}. Active runtimes keep their snapshot until replacement.`;
      } catch (error) {
        return `Failed to add input modality: ${error instanceof Error ? error.message : String(error)}`;
      }
    });
    this.registerCommandDisposer(modalityCommand);
  }

  registerResolver(resolver: SessionResolver): () => void {
    return this.gate.register(resolver);
  }

  override async start(): Promise<void> {
    await this.storage.start();
  }

  getStoragePath(scope: ChannelScope): Promise<string> {
    return this.storage.getStoragePath(scope);
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    const registration = { factory };
    this.plugins.add(registration);
    return () => this.plugins.delete(registration);
  }

  async reset(scope: ChannelScope): Promise<void> {
    return this.rt.reset(scope);
  }

  override stop(): Promise<void> {
    if (!this.stopTask) this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async stopInternal(): Promise<void> {
    this.disposeCommand();
    try {
      this.gate.close();
    } catch (cause) {
      this.warn("gateway.close_failed", cause);
    }
    try {
      await this.rt.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", cause);
    }
    try {
      await this.gate.drain();
    } catch (cause) {
      this.warn("gateway.drain_failed", cause);
    }
  }

  private disposeCommand(): void {
    for (const dispose of this.commandDisposers) {
      try {
        dispose();
      } catch (cause) {
        this.warn("command.dispose_failed", cause);
      }
    }
    this.commandDisposers.clear();
  }

  private registerCommandDisposer(command: { dispose?: () => unknown }): void {
    if (typeof command.dispose === "function") this.commandDisposers.add(() => command.dispose?.());
  }

  private warn(event: string, cause: unknown): void {
    try {
      this.logger.warn({ event, cause: cause instanceof Error ? cause.message : String(cause) });
    } catch {}
  }
}
