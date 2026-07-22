import { isAbsolute, resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Bot, Context, Logger } from "koishi";

import { channelKey, fromEvent, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import type { EventRecord } from "../event/index.js";
import type { AssetStore } from "../shared/asset.js";
import { DefaultWill, type Will } from "../will/index.js";
import { ChannelRuntime } from "./channel.js";
import { createChannelStorage } from "./storage.js";

export interface RuntimeManagerOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly getAgentPlugins: (context: {
    readonly channel: ChannelScope;
    readonly bot: Bot;
  }) => readonly AgentPlugin[];
}

interface RuntimeEntry {
  readonly generation: number;
  readonly runtime: ChannelRuntime;
}

export class RuntimeManager {
  #runtimes = new Map<string, RuntimeEntry>();
  #creating = new Map<string, Promise<RuntimeEntry>>();
  #lifecycleTails = new Map<string, Promise<void>>();
  #generation = 0;
  #willFactory: Will.Factory;
  #stopped = false;
  #stopTask: Promise<void> | undefined;

  constructor(private readonly options: RuntimeManagerOptions) {
    this.#willFactory = () => new DefaultWill(options.config.will);
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
    this.#willFactory = factory;
    this.#generation += 1;
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = channelKey(scope);
    await this.enqueueLifecycle(key, async () => {
      const pending = this.#creating.get(key);
      if (pending) await pending;
      const entry = this.#runtimes.get(key);
      if (entry) {
        await entry.runtime.reset();
        this.#runtimes.delete(key);
        return;
      }
      await this.clearPersisted(scope);
    });
  }

  stop(): Promise<void> {
    if (this.#stopTask) return this.#stopTask;
    this.#stopped = true;
    this.#stopTask = this.stopInternal();
    return this.#stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const key = channelKey(scope);
    const existing = this.#runtimes.get(key);
    if (existing?.generation === this.#generation) return existing.runtime;

    const pending = this.#creating.get(key);
    if (pending) {
      const entry = await pending;
      if (entry.generation === this.#generation) return entry.runtime;
      return this.getOrCreate(scope);
    }

    const creation = this.enqueueLifecycle(key, async () => {
      const current = this.#runtimes.get(key);
      if (current?.generation === this.#generation) return current;
      if (current) {
        await this.stopRuntime(key, current.runtime);
        this.#runtimes.delete(key);
      }
      const entry = await this.createRuntime(scope, this.#generation);
      this.#runtimes.set(key, entry);
      return entry;
    });
    this.#creating.set(key, creation);
    try {
      const entry = await creation;
      if (entry.generation === this.#generation) return entry.runtime;
      return this.getOrCreate(scope);
    } finally {
      if (this.#creating.get(key) === creation) this.#creating.delete(key);
    }
  }

  private async createRuntime(scope: ChannelScope, generation: number): Promise<RuntimeEntry> {
    this.assertOpen();
    const bot = this.options.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const model = this.options.ctx["yesimbot.model"].resolveChatModel(this.options.config.chatModel).model;
    const plugins = this.options.getAgentPlugins({ channel: scope, bot });
    const will = await this.#willFactory(scope);
    return {
      generation,
      runtime: new ChannelRuntime({
        ctx: this.options.ctx,
        config: this.options.config,
        logger: this.options.logger,
        scope,
        bot,
        will,
        assets: this.options.assets,
        model,
        getAgentPlugins: () => plugins,
      }),
    };
  }

  private async stopInternal(): Promise<void> {
    await Promise.allSettled([...this.#creating.values()]);
    const entries = [...this.#runtimes.entries()];
    await Promise.all(
      entries.map(([key, entry]) =>
        this.enqueueLifecycle(key, async () => {
          await this.stopRuntime(key, entry.runtime);
          if (this.#runtimes.get(key) === entry) this.#runtimes.delete(key);
        }),
      ),
    );
    this.#runtimes.clear();
  }

  private async stopRuntime(key: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { key, cause });
    }
  }

  private async clearPersisted(scope: ChannelScope): Promise<void> {
    const basePath = isAbsolute(this.options.config.basePath)
      ? this.options.config.basePath
      : resolve(this.options.ctx.baseDir, this.options.config.basePath);
    await createChannelStorage(basePath, scope).clear();
    await this.options.assets.clear(scope);
  }

  private enqueueLifecycle<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#lifecycleTails.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.#lifecycleTails.set(key, tail);
    void tail.finally(() => {
      if (this.#lifecycleTails.get(key) === tail) this.#lifecycleTails.delete(key);
    });
    return next;
  }

  private assertOpen(): void {
    if (this.#stopped) throw new Error("Runtime manager is stopped");
  }

  private warn(event: string, fields: Record<string, unknown>): void {
    try {
      this.options.logger.warn({ event, ...fields });
    } catch {}
  }
}
