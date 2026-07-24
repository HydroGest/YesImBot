import { isAbsolute, resolve } from "node:path";

import { Service, type Context } from "koishi";

import { channelKey, type ChannelScope } from "./channel/index.js";
import type { Config } from "./config.js";
import { IMAGE_BUDGET } from "./gateway/image.js";
import { Gateway, type SessionResolver } from "./gateway/index.js";
import type { ModelService } from "./model/service.js";
import { RuntimeManager, type AgentPluginFactory } from "./runtime/manager.js";
import { AssetStore } from "./shared/asset.js";
import { assertAssignee } from "./shared/assignee.js";
import { ChannelStorage, type ChannelFilter, type ChannelRecord } from "./storage/index.js";
import { DefaultWill, type Will } from "./will/index.js";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model", "database"];

  readonly model: ModelService;
  private readonly storage: ChannelStorage;
  private readonly asset: AssetStore;
  private readonly rt: RuntimeManager;
  private readonly gate: Gateway;
  private readonly plugins = new Set<{ readonly factory: AgentPluginFactory }>();
  private readonly defaultWill: Will.Factory;
  private readonly wills = new Set<{ readonly factory: Will.Factory }>();
  private dispose: (() => unknown) | undefined;
  private stopTask: Promise<void> | undefined;

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
    this.model = ctx["yesimbot.model"];
    this.defaultWill = () => new DefaultWill(config.will);
    this.storage = new ChannelStorage(
      resolveBasePath(config.basePath, ctx.baseDir),
      (code, fields) => {
        this.logger.warn({ code, ...fields });
      },
    );
    this.asset = new AssetStore({
      storage: this.storage,
      maxFileBytes: IMAGE_BUDGET.maxBytesPerImage,
    });
    this.rt = new RuntimeManager({
      ctx,
      config,
      logger: this.logger,
      assets: this.asset,
      storage: this.storage,
      getAgentPluginFactories: () => [...this.plugins].map(({ factory }) => factory),
    });
    this.gate = new Gateway({
      ctx,
      assets: this.asset,
      runtime: this.rt,
      storage: this.storage,
      ready: () => this.storage.start(),
      logger: this.logger,
    });

    const command = ctx.command("yesimbot.reset", { authority: 4 });
    command.action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) return;
      await this.reset({
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId,
        isDirect: session.isDirect,
      });
    });
    if (typeof command.dispose === "function") this.dispose = () => command.dispose();
  }

  registerResolver(resolver: SessionResolver): () => void {
    return this.gate.register(resolver);
  }

  override async start(): Promise<void> {
    await this.storage.start();
  }

  channelKey(scope: ChannelScope): string {
    return channelKey(scope);
  }

  registerStorage(namespace: string): () => void {
    return this.storage.register(namespace);
  }

  ensureStorage(scope: ChannelScope, namespace: string, ...segments: string[]): Promise<string> {
    return this.storage.ensure(scope, namespace, ...segments);
  }

  listChannels(filter?: ChannelFilter): readonly ChannelRecord[] {
    return this.storage.list(filter);
  }

  registerWill(factory: Will.Factory): () => void {
    const registration = { factory };
    this.wills.add(registration);
    this.rt.setWill(factory);
    return () => {
      const active = this.activeWill();
      this.wills.delete(registration);
      const replacement = this.activeWill();
      if (active === replacement) return;
      this.rt.setWill(replacement ?? this.defaultWill);
    };
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    const registration = { factory };
    this.plugins.add(registration);
    return () => this.plugins.delete(registration);
  }

  async reset(scope: ChannelScope): Promise<void> {
    await assertAssignee(this.ctx, scope);
    return this.rt.reset(scope);
  }

  async reload(scope: ChannelScope): Promise<void> {
    await assertAssignee(this.ctx, scope);
    return this.rt.reload(scope);
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

  private activeWill(): Will.Factory | undefined {
    return [...this.wills].at(-1)?.factory;
  }

  private disposeCommand(): void {
    const dispose = this.dispose;
    this.dispose = undefined;
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
