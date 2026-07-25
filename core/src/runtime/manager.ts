import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger } from "koishi";

import { channelKey, fromEvent, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import type { EventRecord } from "../event/index.js";
import type { AssetStore } from "../shared/asset.js";
import { assertAssignee } from "../shared/assignee.js";
import type { ChannelStorage } from "../storage/index.js";
import { createWillingnessConfig, DefaultWill, WillingnessWill, type Will } from "../will/index.js";
import {
  ChannelRuntime,
  ChannelRuntimeDrainingError,
  type MediaPolicy,
} from "./channel.js";
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
  readonly selfId: string;
  state: "active" | "draining" | "failed";
  readonly runtime: ChannelRuntime;
}

export class RuntimeManager {
  private runtimes = new Map<string, RuntimeEntry>();
  private tails = new Map<string, Promise<void>>();
  private handovers = new Map<string, Promise<void>>();
  private handoverWaiters = new Map<string, number>();
  private gen = 0;
  private customWill: Will.Factory | undefined;
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {}

  async route(record: EventRecord): Promise<RuntimeManager.Result> {
    this.assertOpen();
    const scope = fromEvent(record);
    if (!scope) throw new Error("Accepted event requires a channel");
    for (;;) {
      const runtime = await this.getOrCreate(scope);
      this.assertOpen();
      try {
        const result = await runtime.handle(record);
        if (result.kind !== "run") return result;
        const release = runtime.acquireDeliveryLease();
        return {
          ...result,
          delivery: {
            fail: (failure) => runtime.handleInternal(failure),
            release,
          },
        };
      } catch (cause) {
        if (!(cause instanceof ChannelRuntimeDrainingError)) throw cause;
      }
    }
  }

  setWill(factory?: Will.Factory): void {
    if (this.customWill === factory) return;
    this.customWill = factory;
    this.gen += 1;
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = channelKey(scope);
    const snapshot = await this.enqueueLifecycle(key, async () => {
      this.assertOpen();
      const entry = this.runtimes.get(key);
      if (entry?.state === "draining") return { handover: this.handovers.get(key) };
      await this.assertCurrentAssignee(scope);
      if (entry) {
        try {
          await entry.runtime.reset();
        } finally {
          if (this.runtimes.get(key) === entry) this.runtimes.delete(key);
        }
        return {};
      }
      await this.clearPersisted(scope);
      return {};
    });
    if (!snapshot.handover) return;
    await snapshot.handover;
    await this.getOrCreate(scope);
    return this.reset(scope);
  }

  async reload(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = channelKey(scope);
    const entry = await this.enqueueLifecycle(key, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      const current = this.runtimes.get(key);
      if (!current) return undefined;
      if (current.state === "failed") {
        throw new Error("Channel handover failed; restart required");
      }
      return current;
    });
    if (entry) await this.awaitHandover(key, entry);
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const key = channelKey(scope);

    // Fast path: an existing active Runtime with the current identity.
    // Call assertCurrentAssignee directly without entering the lifecycle queue.
    // The Database query provides a natural yield point; after it resolves,
    // re-check the Runtime state synchronously. A generation or assignee change
    // during the await is detected by this re-check, preventing the event from
    // joining the lifecycle tail as an unbounded unreserved waiter.
    const current = this.runtimes.get(key);
    if (
      current &&
      current.state === "active" &&
      current.selfId === scope.selfId &&
      current.generation === this.gen
    ) {
      await this.assertCurrentAssignee(scope);
      const after = this.runtimes.get(key);
      if (
        after === current &&
        after.state === "active" &&
        after.selfId === scope.selfId &&
        after.generation === this.gen &&
        !this.handovers.has(key)
      ) {
        return current.runtime;
      }
    }

    // Reserve a handover slot before entering the lifecycle queue to prevent
    // unbounded queue growth from events that trigger or join a handover.
    const needsHandover = this.wouldNeedHandover(key, scope);
    if (needsHandover) {
      const waiting = this.handoverWaiters.get(key) ?? 0;
      if (waiting >= 5) throw new Error("Channel handover queue is full");
      this.handoverWaiters.set(key, waiting + 1);
    }

    try {
      const result: { readonly runtime: ChannelRuntime } | { readonly handover: RuntimeEntry } =
        await this.enqueueLifecycle(key, async () => {
          this.assertOpen();
          await this.assertCurrentAssignee(scope);
          const current = this.runtimes.get(key);
          if (current?.state === "failed")
            throw new Error("Channel handover failed; restart required");
          if (current) {
            if (
              current.state === "draining" ||
              current.selfId !== scope.selfId ||
              current.generation !== this.gen
            ) {
              return { handover: current };
            }
            return { runtime: current.runtime };
          }
          await this.assertCurrentAssignee(scope);
          let entry: RuntimeEntry;
          for (;;) {
            const capturedGen = this.gen;
            entry = await this.createRuntime(scope, capturedGen);
            if (entry.generation === this.gen) break;
            await this.stopRuntime(key, entry.runtime);
          }
          // Manager may have stopped during async construction
          try {
            this.assertOpen();
          } catch (cause) {
            await this.stopRuntime(key, entry.runtime);
            throw cause;
          }
          this.runtimes.set(key, entry);
          return { runtime: entry.runtime };
        });
      if ("runtime" in result) return result.runtime;
      await this.awaitHandover(key, result.handover);
      await this.assertCurrentAssignee(scope);
      return this.getOrCreate(scope);
    } finally {
      if (needsHandover) {
        const remaining = (this.handoverWaiters.get(key) ?? 1) - 1;
        if (remaining === 0) this.handoverWaiters.delete(key);
        else this.handoverWaiters.set(key, remaining);
      }
    }
  }

  private wouldNeedHandover(key: string, scope: ChannelScope): boolean {
    const current = this.runtimes.get(key);
    return (
      current !== undefined &&
      (current.state === "draining" ||
        current.selfId !== scope.selfId ||
        current.generation !== this.gen)
    );
  }

  private async createRuntime(scope: ChannelScope, generation: number): Promise<RuntimeEntry> {
    this.assertOpen();
    const bot = this.opts.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const resolved = this.opts.ctx["yesimbot.model"].resolveChatModel(this.opts.config.chatModel);
    const imageInput = resolved.entry.modalities?.input?.includes("image") === true;
    const mediaPolicy: MediaPolicy = Object.freeze({
      enabled: this.opts.config.multimedia?.enabled ?? true,
      maxImages: this.opts.config.multimedia?.image?.maxCountPerCall ?? 4,
      maxImageBytes: this.opts.config.multimedia?.image?.maxBytesPerImage ?? 5 * 1024 * 1024,
      maxTotalImageBytes: this.opts.config.multimedia?.image?.maxBytesPerCall ?? 10 * 1024 * 1024,
      strategy: this.opts.config.multimedia?.image?.selection ?? "current-first",
    });
    const factories = this.opts.getAgentPluginFactories();
    const plugins = (
      await Promise.all(factories.map((factory) => factory({ channel: scope, bot })))
    ).filter((plugin): plugin is AgentPlugin => plugin !== null);
    const includeMessageId = factories.some((factory) => factory.requiresMessageId === true);
    const will = this.customWill
      ? await this.customWill(scope)
      : this.opts.config.will?.engine === "willingness"
          ? new WillingnessWill({
            config: createWillingnessConfig(this.opts.config.will),
            now: Date.now,
            random: Math.random,
            warn: (event, fields) => this.opts.logger.warn({ event, ...fields }),
          })
        : new DefaultWill(this.opts.config.will);
    const storagePath = await this.opts.storage.ensure(scope, "sessions", "messages.jsonl");
    const runtime = new ChannelRuntime({
      ctx: this.opts.ctx,
      config: this.opts.config,
      logger: this.opts.logger,
      scope,
      bot,
      will,
      assets: this.opts.assets,
      model: resolved.model,
      imageInput,
      mediaPolicy,
      agentPlugins: plugins,
      includeMessageId,
      storage: createJsonlStorage(storagePath),
    });
    try {
      await runtime.init();
    } catch (cause) {
      await runtime.stop().catch(() => undefined);
      throw cause;
    }
    return {
      generation,
      selfId: scope.selfId,
      state: "active",
      runtime,
    };
  }

  private async stopInternal(): Promise<void> {
    await Promise.allSettled([...this.tails.values()]);
    const entries = [...this.runtimes.entries()];
    await Promise.all(entries.map(([key, entry]) => this.stopRuntime(key, entry.runtime)));
    await Promise.allSettled([...this.handovers.values()]);
    this.runtimes.clear();
    this.tails.clear();
    this.handovers.clear();
    this.handoverWaiters.clear();
  }

  private async awaitHandover(key: string, entry: RuntimeEntry): Promise<void> {
    let task = this.handovers.get(key);
    if (!task) {
      task = this.runHandover(key, entry);
      this.handovers.set(key, task);
      void task
        .finally(() => {
          if (this.handovers.get(key) === task) this.handovers.delete(key);
        })
        .catch(() => undefined);
    }
    await task;
  }

  private async runHandover(key: string, entry: RuntimeEntry): Promise<void> {
    try {
      await this.enqueueLifecycle(key, async () => {
        this.assertOpen();
        if (this.runtimes.get(key) !== entry) throw new Error("Channel handover is stale");
        if (entry.state === "failed") throw new Error("Channel handover failed; restart required");
        entry.state = "draining";
        entry.runtime.beginDrain();
      });
      await entry.runtime.drainAndStop();
    } catch (cause) {
      await this.enqueueLifecycle(key, async () => {
        if (this.runtimes.get(key) === entry) entry.state = "failed";
      });
      throw cause;
    }
    await this.enqueueLifecycle(key, async () => {
      if (this.runtimes.get(key) === entry && entry.state === "draining") {
        this.runtimes.delete(key);
      }
    });
  }

  private async stopRuntime(key: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { key, cause });
    }
  }

  private async assertCurrentAssignee(scope: ChannelScope): Promise<void> {
    try {
      await assertAssignee(this.opts.ctx, scope);
    } catch (cause) {
      this.warn("runtime.assignee_rejected", { scope, cause });
      throw cause;
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

export namespace RuntimeManager {
  export interface Delivery {
    fail(record: EventRecord<"delivery.failed">): Promise<ChannelRuntime.Result>;
    release(): void;
  }

  export type Result =
    | Exclude<ChannelRuntime.Result, { readonly kind: "run" }>
    | (Extract<ChannelRuntime.Result, { readonly kind: "run" }> & {
        readonly delivery: Delivery;
      });
}
