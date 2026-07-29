import { resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import type { Awaitable, Bot, Context, Logger } from "koishi";
import { Universal } from "koishi";

import { channelIdentity, type ChannelScope } from "../channel/index.js";
import { resolveMultimediaImagePolicy, type Config } from "../config.js";
import type { InputRecord } from "../input.js";
import type { AssetStore } from "../media/index.js";
import type { ChannelStorage } from "../storage/index.js";
import { ChannelRuntime, type ChannelRuntimeOptions, type ChannelRuntimeResult } from "./channel.js";
import { createJsonlStorage } from "./storage.js";
import { createWillEngine } from "./will.js";

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
  private readonly runtimes = new Map<string, ChannelRuntime>();
  private readonly creating = new Map<string, Promise<ChannelRuntime>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {}

  async route(record: InputRecord): Promise<ChannelRuntimeResult> {
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
    return runtime.handle(record);
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const identity = channelIdentity(scope);
    let failure: unknown;
    const runtime = this.runtimes.get(identity);
    if (runtime) {
      try {
        await runtime.stop();
      } catch (cause) {
        failure = cause;
        this.warn("runtime.stop_failed", { identity, cause });
      } finally {
        if (this.runtimes.get(identity) === runtime) this.runtimes.delete(identity);
      }
    }
    try {
      await createJsonlStorage(await this.opts.storage.ensure(scope, "sessions", "messages.jsonl")).clear();
    } catch (cause) {
      failure ??= cause;
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

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const identity = channelIdentity(scope);
    for (;;) {
      const runtime = this.runtimes.get(identity);
      if (runtime?.selfId === scope.selfId) return runtime;

      const pending = this.creating.get(identity);
      if (pending) {
        await pending;
        continue;
      }

      const creating = this.replaceRuntime(scope, runtime);
      this.creating.set(identity, creating);
      try {
        return await creating;
      } finally {
        if (this.creating.get(identity) === creating) this.creating.delete(identity);
      }
    }
  }

  private async replaceRuntime(scope: ChannelScope, current: ChannelRuntime | undefined): Promise<ChannelRuntime> {
    const identity = channelIdentity(scope);
    if (current && current.selfId !== scope.selfId) {
      await this.stopRuntime(identity, current);
      if (this.runtimes.get(identity) === current) this.runtimes.delete(identity);
    }
    const runtime = await this.createRuntime(scope);
    try {
      this.assertOpen();
    } catch (cause) {
      await this.stopRuntime(identity, runtime);
      throw cause;
    }
    this.runtimes.set(identity, runtime);
    return runtime;
  }

  private async createRuntime(scope: ChannelScope): Promise<ChannelRuntime> {
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
    return runtime;
  }

  private async stopInternal(): Promise<void> {
    await Promise.all([...this.runtimes.entries()].map(([identity, runtime]) => this.stopRuntime(identity, runtime)));
    this.runtimes.clear();
    this.creating.clear();
  }

  private async stopRuntime(identity: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { identity, cause });
    }
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
