import { join, resolve } from "node:path";

import { createJsonlStorage, type AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger } from "koishi";
import { Universal } from "koishi";

import type { AssetService } from "../asset.js";
import type { ImageBudget, Config } from "../config.js";
import type { EventRecord, MessageRecord } from "../messages.js";
import { ModelService } from "../model/index.js";
import { ChannelRuntime, type ChannelRuntimeOptions, type ChannelRuntimeResult } from "./channel.js";
import { ChannelScope, ChannelStorage, scopeMapKey } from "./storage.js";
import { createWillEngine } from "./will.js";

export interface ChannelPluginContext {
  readonly scope: ChannelScope;
  readonly bot: Bot;
}

export type ChannelPluginFactory = (context: ChannelPluginContext) => Awaitable<AgentPlugin | null>;

export class RuntimeManager {
  private readonly runtimes = new Map<string, ChannelRuntime>();
  private readonly creating = new Map<string, Promise<ChannelRuntime>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  private readonly ctx: Context;
  private readonly config: Config;
  private readonly model: ModelService;
  private readonly logger: Logger;
  private readonly channelPlugins: ReadonlySet<ChannelPluginFactory>;
  private readonly assets: AssetService;
  private readonly storage: ChannelStorage;

  constructor(
    ctx: Context,
    model: ModelService,
    assets: AssetService,
    storage: ChannelStorage,
    config: Config,
    channelPlugins: ReadonlySet<ChannelPluginFactory>,
  ) {
    this.ctx = ctx;
    this.config = config;
    this.model = model;
    this.logger = ctx.logger("runtime");
    this.assets = assets;
    this.storage = storage;
    this.channelPlugins = channelPlugins;
  }

  public async route(record: MessageRecord | EventRecord): Promise<ChannelRuntimeResult> {
    this.assertOpen();
    const runtime = await this.runtimeFor(record);
    this.assertOpen();
    return runtime.handle(record);
  }

  public async trigger(record: EventRecord): Promise<ChannelRuntimeResult> {
    this.assertOpen();
    const runtime = await this.runtimeFor(record);
    this.assertOpen();
    return runtime.trigger(record);
  }

  private async runtimeFor(record: MessageRecord | EventRecord): Promise<ChannelRuntime> {
    const scope: ChannelScope | null = record.channel?.id
      ? {
          type: record.channel.type === Universal.Channel.Type.DIRECT ? "direct" : "shared",
          platform: record.platform,
          selfId: record.selfId,
          channelId: record.channel.id,
        }
      : null;
    if (!scope) throw new Error("Accepted event requires a channel");
    return this.getOrCreate(scope);
  }

  public async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = scopeMapKey(scope);
    let failure: unknown;
    const runtime = this.runtimes.get(key);
    if (runtime) {
      try {
        await runtime.stop();
      } catch (cause) {
        failure = cause;
        this.logger.warn("runtime.stop_failed", { scope, cause });
      } finally {
        if (this.runtimes.get(key) === runtime) this.runtimes.delete(key);
      }
    }
    try {
      await createJsonlStorage(join(await this.storage.getStoragePath(scope), "sessions", "messages.jsonl")).clear();
    } catch (cause) {
      failure ??= cause;
      this.logger.warn("storage_clear_failed", { scope, cause });
    }
    try {
      await this.assets.createStore(scope).clear();
    } catch (cause) {
      this.logger.warn("asset_clear_failed", { scope, cause });
      failure ??= cause;
    }
    if (failure) throw failure;
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const key = scopeMapKey(scope);
    for (;;) {
      const runtime = this.runtimes.get(key);
      if (runtime?.selfId === scope.selfId) return runtime;

      const pending = this.creating.get(key);
      if (pending) {
        await pending;
        continue;
      }

      const creating = this.replaceRuntime(scope, runtime);
      this.creating.set(key, creating);
      try {
        return await creating;
      } finally {
        if (this.creating.get(key) === creating) this.creating.delete(key);
      }
    }
  }

  private async replaceRuntime(scope: ChannelScope, current: ChannelRuntime | undefined): Promise<ChannelRuntime> {
    const key = scopeMapKey(scope);
    if (current && current.selfId !== scope.selfId) {
      await this.stopRuntime(key, current);
      if (this.runtimes.get(key) === current) this.runtimes.delete(key);
    }
    const runtime = await this.createRuntime(scope);
    try {
      this.assertOpen();
    } catch (cause) {
      await this.stopRuntime(key, runtime);
      throw cause;
    }
    this.runtimes.set(key, runtime);
    return runtime;
  }

  private async createRuntime(scope: ChannelScope): Promise<ChannelRuntime> {
    this.assertOpen();
    const bot = this.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const resolved = this.model.resolveChatModel(this.config.chatModel);
    const plugins = (await Promise.all([...this.channelPlugins].map((resolver) => resolver({ scope, bot })))).filter(
      (plugin): plugin is AgentPlugin => plugin !== null,
    );
    const options: ChannelRuntimeOptions = {
      config: {
        ...this.config,
        basePath: resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir),
      },
      scope,
      bot,
      will: createWillEngine(this.ctx, this.config.will),
      assets: this.assets.createStore(scope),
      model: resolved.model,
      imageBudget: this.config.imageInput ? ({ ...this.config.imageInput } as ImageBudget) : null,
      agentPlugins: plugins,
      storage: createJsonlStorage(join(await this.storage.getStoragePath(scope), "sessions", "messages.jsonl")),
    };
    const runtime = new ChannelRuntime(this.ctx, options);
    try {
      await runtime.init();
    } catch (cause) {
      await runtime.stop().catch(() => undefined);
      throw cause;
    }
    return runtime;
  }

  private async stopInternal(): Promise<void> {
    await Promise.all([...this.runtimes.entries()].map(([identity, runtime]) => this.stopRuntime(identity, runtime)));
    this.runtimes.clear();
    this.creating.clear();
  }

  private async stopRuntime(key: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.logger.warn("runtime.stop_failed", { key, cause });
    }
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Runtime manager is stopped");
  }
}
