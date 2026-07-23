import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger } from "koishi";

import { assertAssignee } from "../assignee.js";
import { channelKey, fromEvent, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import type { EventRecord } from "../event/index.js";
import type { AssetStore } from "../shared/asset.js";
import type { ChannelStorage } from "../storage/index.js";
import { DefaultWill, type Will } from "../will/index.js";
import { ChannelRuntime } from "./channel.js";
import { createJsonlStorage } from "./storage.js";

export interface RuntimeManagerOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly storage: ChannelStorage;
  readonly getAgentPluginFactories: () => readonly AgentPluginFactory[];
}

export interface AgentPluginFactory {
  (context: { readonly channel: ChannelScope; readonly bot: Bot }): Awaitable<AgentPlugin | null>;
  readonly requiresMessageId?: boolean;
}

interface RuntimeEntry {
  readonly generation: number;
  readonly runtime: ChannelRuntime;
}

export class RuntimeManager {
  private runtimes = new Map<string, RuntimeEntry>();
  private tails = new Map<string, Promise<void>>();
  private gen = 0;
  private makeWill: Will.Factory;
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {
    this.makeWill = () => new DefaultWill(opts.config.will);
  }

  async route(record: EventRecord): Promise<ChannelRuntime.Result> {
    this.assertOpen();
    const scope = fromEvent(record);
    if (!scope) throw new Error("Accepted event requires a channel");
    const runtime = await this.getOrCreate(scope);
    this.assertOpen();
    return runtime.handle(record);
  }

  setWill(factory: Will.Factory): void {
    this.makeWill = factory;
    this.gen += 1;
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = channelKey(scope);
    await this.enqueueLifecycle(key, async () => {
      this.assertOpen();
      try {
        await assertAssignee(this.opts.ctx, scope);
      } catch (cause) {
        this.warn("runtime.assignee_rejected", { scope, cause });
        throw cause;
      }
      const entry = this.runtimes.get(key);
      if (entry) {
        try {
          await entry.runtime.reset();
        } finally {
          if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
        }
        return;
      }
      await this.clearPersisted(scope);
    });
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const key = channelKey(scope);
    const entry = await this.enqueueLifecycle(key, async () => {
      this.assertOpen();
      try {
        await assertAssignee(this.opts.ctx, scope);
      } catch (cause) {
        this.warn("runtime.assignee_rejected", { scope, cause });
        throw cause;
      }
      const current = this.runtimes.get(key);
      if (current?.generation === this.gen) return current;
      if (current) {
        await this.stopRuntime(key, current.runtime);
        this.runtimes.delete(key);
      }
      const entry = await this.createRuntime(scope, this.gen);
      this.runtimes.set(key, entry);
      return entry;
    });
    if (entry.generation === this.gen) return entry.runtime;
    return this.getOrCreate(scope);
  }

  private async createRuntime(scope: ChannelScope, generation: number): Promise<RuntimeEntry> {
    this.assertOpen();
    const bot = this.opts.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const model = this.opts.ctx["yesimbot.model"].resolveChatModel(
      this.opts.config.chatModel,
    ).model;
    const factories = this.opts.getAgentPluginFactories();
    const plugins = (
      await Promise.all(factories.map((factory) => factory({ channel: scope, bot })))
    ).filter((plugin): plugin is AgentPlugin => plugin !== null);
    const includeMessageId = factories.some((factory) => factory.requiresMessageId === true);
    const will = await this.makeWill(scope);
    const storagePath = await this.opts.storage.ensure(scope, "sessions", "messages.jsonl");
    return {
      generation,
      runtime: new ChannelRuntime({
        ctx: this.opts.ctx,
        config: this.opts.config,
        logger: this.opts.logger,
        scope,
        bot,
        will,
        assets: this.opts.assets,
        model,
        agentPlugins: plugins,
        includeMessageId,
        storage: createJsonlStorage(storagePath),
      }),
    };
  }

  private async stopInternal(): Promise<void> {
    await Promise.allSettled([...this.tails.values()]);
    const entries = [...this.runtimes.entries()];
    await Promise.all(
      entries.map(([key, entry]) =>
        this.enqueueLifecycle(key, async () => {
          await this.stopRuntime(key, entry.runtime);
          if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
        }),
      ),
    );
    this.runtimes.clear();
  }

  private async stopRuntime(key: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { key, cause });
    }
  }

  private async clearPersisted(scope: ChannelScope): Promise<void> {
    let failure: unknown;
    try {
      const storagePath = await this.opts.storage.ensure(scope, "sessions", "messages.jsonl");
      await createJsonlStorage(storagePath).clear();
    } catch (cause) {
      failure = cause;
      this.warn("storage_clear_failed", { scope, cause });
    }
    try {
      await this.opts.assets.clear(scope);
    } catch (cause) {
      failure ??= cause;
      this.warn("asset_clear_failed", { scope, cause });
    }
    if (failure) throw failure;
  }

  private enqueueLifecycle<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Runtime manager is stopped");
  }

  private warn(event: string, fields: Record<string, unknown>): void {
    try {
      this.opts.logger.warn({ event, ...fields });
    } catch {}
  }
}
