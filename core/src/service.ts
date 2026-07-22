import { isAbsolute, resolve } from "node:path";
import { Service, type Context } from "koishi";

import type { ChannelScope } from "./channel/index.js";
import type { Config } from "./config.js";
import { Gateway, type SessionResolver } from "./gateway/index.js";
import { IMAGE_BUDGET } from "./gateway/image.js";
import type { ModelService } from "./model/service.js";
import { RuntimeManager, type AgentPluginFactory } from "./runtime/manager.js";
import { AssetStore } from "./shared/asset.js";
import { DefaultWill, type Will } from "./will/index.js";

export type { AgentPluginFactory } from "./runtime/manager.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model"];

  readonly model: ModelService;
  readonly #assets: AssetStore;
  readonly #runtime: RuntimeManager;
  readonly #gateway: Gateway;
  readonly #agentPluginRegistrations = new Set<{ readonly factory: AgentPluginFactory }>();
  readonly #defaultWill: Will.Factory;
  readonly #willRegistrations = new Set<{ readonly factory: Will.Factory }>();
  #disposeCommand: (() => unknown) | undefined;
  #stopTask: Promise<void> | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    Object.defineProperty(this, "config", {
      value: config,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    this.logger.level = config.logLevel ?? 2;
    this.model = ctx["yesimbot.model"];
    this.#defaultWill = () => new DefaultWill(config.will);
    this.#assets = new AssetStore({
      basePath: resolveBasePath(config.basePath, ctx.baseDir),
      maxFileBytes: IMAGE_BUDGET.maxBytesPerImage,
    });
    this.#runtime = new RuntimeManager({
      ctx,
      config,
      logger: this.logger,
      assets: this.#assets,
      getAgentPluginFactories: () => [...this.#agentPluginRegistrations].map(({ factory }) => factory),
    });
    this.#gateway = new Gateway({ ctx, assets: this.#assets, runtime: this.#runtime, logger: this.logger });

    const command = ctx.command("yesimbot.reset", { authority: 4 });
    command.action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) return;
      await this.reset({ platform: session.platform, selfId: session.selfId, channelId: session.channelId });
    });
    if (typeof command.dispose === "function") this.#disposeCommand = () => command.dispose();
  }

  registerResolver(resolver: SessionResolver): () => void {
    return this.#gateway.register(resolver);
  }

  registerWill(factory: Will.Factory): () => void {
    const registration = { factory };
    this.#willRegistrations.add(registration);
    this.#runtime.setWill(factory);
    return () => {
      const active = this.activeWill();
      this.#willRegistrations.delete(registration);
      const replacement = this.activeWill();
      if (active === replacement) return;
      this.#runtime.setWill(replacement ?? this.#defaultWill);
    };
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    const registration = { factory };
    this.#agentPluginRegistrations.add(registration);
    return () => this.#agentPluginRegistrations.delete(registration);
  }

  reset(scope: ChannelScope): Promise<void> {
    return this.#runtime.reset(scope);
  }

  override stop(): Promise<void> {
    if (!this.#stopTask) this.#stopTask = this.stopInternal();
    return this.#stopTask;
  }

  private async stopInternal(): Promise<void> {
    this.disposeCommand();
    try {
      this.#gateway.close();
    } catch (cause) {
      this.warn("gateway.close_failed", cause);
    }
    try {
      await this.#runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", cause);
    }
    try {
      await this.#gateway.drain();
    } catch (cause) {
      this.warn("gateway.drain_failed", cause);
    }
  }

  private activeWill(): Will.Factory | undefined {
    return [...this.#willRegistrations].at(-1)?.factory;
  }

  private disposeCommand(): void {
    const dispose = this.#disposeCommand;
    this.#disposeCommand = undefined;
    try {
      dispose?.();
    } catch (cause) {
      this.warn("command.dispose_failed", cause);
    }
  }

  private warn(event: string, cause: unknown): void {
    try {
      this.logger.warn({ event, cause: cause instanceof Error ? cause.message : String(cause) });
    } catch {}
  }
}

function resolveBasePath(basePath: string, ctxBaseDir: string): string {
  return isAbsolute(basePath) ? basePath : resolve(ctxBaseDir, basePath);
}
