import { resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger } from "koishi";
import { Universal } from "koishi";

import { channelIdentity, type ChannelScope } from "../channel/index.js";
import { resolveMultimediaImagePolicy, type Config } from "../config.js";
import type { EventRecord, InputRecord } from "../input.js";
import type { AssetStore } from "../media/index.js";
import type { ChannelStorage } from "../storage/index.js";
import { createWillEngine } from "../will/index.js";
import {
  ChannelRuntime,
  ChannelRuntimeDrainingError,
  type ChannelRuntimeOptions,
  type ChannelRuntimeResult,
} from "./channel.js";
import { serialQueue, type SerialQueue } from "./serial-queue.js";
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
  readonly selfId: string;
  state: "active" | "reloading" | "failed";
  readonly runtime: ChannelRuntime;
}

type RuntimeDelivery = {
  readonly fail: (record: EventRecord<"delivery.failed">) => Promise<ChannelRuntimeResult>;
  readonly complete: (turnId: string) => Promise<void>;
  readonly signal: AbortSignal;
  readonly release: () => void;
};

type RuntimeResult =
  | Exclude<ChannelRuntimeResult, { readonly kind: "run" }>
  | (Extract<ChannelRuntimeResult, { readonly kind: "run" }> & { readonly delivery: RuntimeDelivery });

export class RuntimeReloadRequiredError extends Error {
  readonly name = "RuntimeReloadRequiredError";
  constructor(readonly scope: ChannelScope) {
    super(`Runtime reload is required for ${scope.platform}:${scope.channelId}`);
  }
}

export class RuntimeReloadInProgressError extends Error {
  readonly name = "RuntimeReloadInProgressError";
  constructor(readonly scope: ChannelScope) {
    super(`Runtime reload is in progress for ${scope.platform}:${scope.channelId}`);
  }
}

export class AssigneeAdmissionError extends Error {
  constructor(
    readonly reason: "missing" | "empty" | "mismatch",
    readonly scope: ChannelScope,
  ) {
    super(`Shared channel assignee admission failed: ${reason}`);
  }
}

export async function assertAssignee(ctx: Context, scope: ChannelScope): Promise<void> {
  if (scope.isDirect) return;
  const [channel] = await ctx.database.get(
    "channel",
    { platform: scope.platform, id: scope.channelId },
    ["assignee"],
  );
  if (!channel) throw new AssigneeAdmissionError("missing", scope);
  if (!channel.assignee) throw new AssigneeAdmissionError("empty", scope);
  if (channel.assignee !== scope.selfId) throw new AssigneeAdmissionError("mismatch", scope);
}

export class RuntimeManager {
  private runtimes = new Map<string, RuntimeEntry>();
  private queues = new Map<string, SerialQueue>();
  private latestLifecycle = new Map<string, Promise<unknown>>();
  private reloads = new Map<string, Promise<void>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {}

  async route(record: InputRecord): Promise<RuntimeResult> {
    this.assertOpen();
    const scope = record.channel?.id
      ? {
          platform: record.platform,
          selfId: record.selfId,
          channelId: record.channel.id,
          isDirect: record.channel.type === Universal.Channel.Type.DIRECT,
        }
      : null;
    if (!scope) throw new Error("Accepted event requires a channel");
    const runtime = await this.getOrCreate(scope);
    this.assertOpen();
    let result: ChannelRuntimeResult;
    try {
      result = await runtime.handle(record);
    } catch (cause) {
      if (cause instanceof ChannelRuntimeDrainingError) throw new RuntimeReloadInProgressError(scope);
      throw cause;
    }
    if (result.kind !== "run") return result;
    const releaseLease = runtime.acquireDeliveryLease();
    return {
      ...result,
      delivery: {
        fail: (failure) => runtime.handleInternal(failure),
        complete: (turnId) => runtime.complete(turnId),
        signal: runtime.deliverySignal(result.turnId),
        release: () => {
          runtime.releaseDelivery(result.turnId);
          releaseLease();
        },
      },
    };
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const identity = channelIdentity(scope);
    const entry = await this.schedule(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      const current = this.runtimes.get(identity);
      if (!current) return undefined;
      if (current.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      current.state = "reloading";
      current.runtime.beginDrain();
      return current;
    });
    if (entry) await entry.runtime.drainAndStop();
    await this.schedule(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      try {
        await this.clearPersisted(scope);
      } finally {
        if (!entry || this.runtimes.get(identity) === entry) this.runtimes.delete(identity);
      }
    });
  }

  async reload(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const identity = channelIdentity(scope);
    const existing = this.reloads.get(identity);
    if (existing) return existing;
    const task = this.reloadRuntime(identity, scope);
    this.reloads.set(identity, task);
    void task.finally(() => {
      if (this.reloads.get(identity) === task) this.reloads.delete(identity);
    }).catch(() => undefined);
    return task;
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async reloadRuntime(identity: string, scope: ChannelScope): Promise<void> {
    const entry = await this.schedule(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      const current = this.runtimes.get(identity);
      if (!current) return undefined;
      if (current.state === "failed") throw new Error("Runtime reload failed; restart required");
      if (current.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      current.state = "reloading";
      current.runtime.beginDrain();
      return current;
    });
    if (!entry) return;
    try {
      await entry.runtime.drainAndStop();
    } catch (cause) {
      await this.schedule(identity, async () => {
        if (this.runtimes.get(identity) === entry) entry.state = "failed";
      });
      throw cause;
    }
    await this.schedule(identity, async () => {
      if (this.runtimes.get(identity) === entry && entry.state === "reloading") this.runtimes.delete(identity);
    });
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const identity = channelIdentity(scope);
    const current = this.runtimes.get(identity);
    if (current?.state === "reloading") throw new RuntimeReloadInProgressError(scope);
    if (current?.state === "failed") throw new Error("Runtime reload failed; restart required");
    if (current && current.selfId !== scope.selfId) throw new RuntimeReloadRequiredError(scope);
    if (current?.state === "active") return current.runtime;
    return this.schedule(identity, async () => {
      this.assertOpen();
      const existing = this.runtimes.get(identity);
      if (existing?.state === "failed") throw new Error("Runtime reload failed; restart required");
      if (existing?.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      if (existing && existing.selfId !== scope.selfId) throw new RuntimeReloadRequiredError(scope);
      if (existing) return existing.runtime;
      const entry = await this.createRuntime(scope);
      try {
        this.assertOpen();
      } catch (cause) {
        await this.stopRuntime(identity, entry.runtime);
        throw cause;
      }
      this.runtimes.set(identity, entry);
      return entry.runtime;
    });
  }

  private async createRuntime(scope: ChannelScope): Promise<RuntimeEntry> {
    this.assertOpen();
    const bot = this.opts.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const resolved = this.opts.ctx["yesimbot.model"].resolveChatModel(this.opts.config.chatModel);
    const factories = this.opts.getAgentPluginFactories();
    const plugins = (await Promise.all(factories.map((factory) => factory({ channel: scope, bot })))).filter(
      (plugin): plugin is AgentPlugin => plugin !== null,
    );
    const options: ChannelRuntimeOptions = {
      ctx: this.opts.ctx,
      config: {
        ...this.opts.config,
        basePath: resolve(this.opts.ctx.baseDir, this.opts.config.basePath || this.opts.ctx.baseDir),
      },
      logger: this.opts.logger,
      scope,
      bot,
      will: createWillEngine(this.opts.config.will, {
        now: Date.now,
        random: Math.random,
        warn: (event, fields) => this.opts.logger.warn({ event, ...fields }),
      }),
      assets: this.opts.assets,
      model: resolved.model,
      provider: resolved.providerId,
      imageInput: resolved.entry.modalities?.input?.includes("image") === true,
      mediaPolicy: resolveMultimediaImagePolicy(this.opts.config.multimedia),
      agentPlugins: plugins,
      includeMessageId: factories.some((factory) => factory.requiresMessageId === true),
      storage: createJsonlStorage(
        await this.opts.storage.ensure(scope, "sessions", "messages.jsonl"),
        (cause) => this.warn("storage.line_invalid", { scope, cause }),
      ),
    };
    const runtime = new ChannelRuntime(options);
    try {
      await runtime.init();
    } catch (cause) {
      await runtime.stop().catch(() => undefined);
      throw cause;
    }
    return { selfId: scope.selfId, state: "active", runtime };
  }

  private async stopInternal(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.run(async () => undefined)));
    await Promise.all([...this.runtimes.entries()].map(([identity, entry]) => this.stopRuntime(identity, entry.runtime)));
    this.runtimes.clear();
    this.queues.clear();
    this.latestLifecycle.clear();
    this.reloads.clear();
  }

  private async stopRuntime(identity: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { identity, cause });
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
      await createJsonlStorage(await this.opts.storage.ensure(scope, "sessions", "messages.jsonl")).clear();
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

  private schedule<T>(identity: string, operation: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(identity) ?? serialQueue();
    this.queues.set(identity, queue);
    const scheduled = queue.run(operation);
    const token = scheduled.then(
      () => undefined,
      () => undefined,
    );
    this.latestLifecycle.set(identity, token);
    void token.then(() => {
      if (this.latestLifecycle.get(identity) !== token) return;
      this.latestLifecycle.delete(identity);
      this.queues.delete(identity);
    });
    return scheduled;
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
  export type Delivery = RuntimeDelivery;
}
