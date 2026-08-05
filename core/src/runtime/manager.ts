import fs from "node:fs/promises";
import { join, resolve } from "node:path";

import { createJsonlStorage, type AgentEntry, type AgentPlugin, type AgentStorage } from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";
import type { Awaitable, Bot, Context, Logger } from "koishi";
import { Universal } from "koishi";

import type { ArtifactService, ArtifactStore } from "../artifact.js";
import type { AssetService } from "../asset.js";
import type { ImageBudget, Config } from "../config.js";
import type { EventRecord, MessageRecord } from "../messages.js";
import { ModelService } from "../model/index.js";
import { ChannelRuntime, type ChannelRuntimeOptions, type ChannelRuntimeResult } from "./channel.js";
import { archiveSession } from "./compact/archive.js";
import { HARD_TRUNCATION_MESSAGE } from "./compact/constants.js";
import { createCompactPlugin, executeCompact, filterEntriesForCompression } from "./compact/index.js";
import { readPersona } from "./prompt.js";
import type { ResourceSchemeOpenHandler } from "./read.js";
import { createNewSession, listSessions, migrateOldSession, resolveActiveSession } from "./session-files.js";
import { ChannelScope, ChannelStorage, scopeMapKey } from "./storage.js";
import { createWillEngine } from "./will.js";

export interface ChannelPluginContext {
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly artifacts: ArtifactStore;
}

export type ChannelPluginFactory = (context: ChannelPluginContext) => Awaitable<AgentPlugin | null>;

interface RuntimeSession {
  compact(): Promise<void>;
  summarize(entries: readonly AgentEntry[]): Promise<string>;
  readonly failureCount: () => number;
  readonly sessionsDir: string;
  readonly storage: AgentStorage<AgentEntry>;
}

export class RuntimeManager {
  private readonly runtimes = new Map<string, ChannelRuntime>();
  private readonly creating = new Map<string, Promise<ChannelRuntime>>();
  private stopped = false;
  private readonly sessions = new WeakMap<ChannelRuntime, RuntimeSession>();
  private stopTask: Promise<void> | undefined;

  private readonly ctx: Context;
  private readonly config: Config;
  private readonly model: ModelService;
  private readonly logger: Logger;
  private readonly channelPlugins: ReadonlySet<ChannelPluginFactory>;
  private readonly assets: AssetService;
  private readonly artifacts: ArtifactService;
  private readonly storage: ChannelStorage;
  private readonly resourceSchemeRegistrations: ReadonlyMap<
    string,
    { prompt: string; open: ResourceSchemeOpenHandler }
  >;

  constructor(
    ctx: Context,
    model: ModelService,
    assets: AssetService,
    artifacts: ArtifactService,
    storage: ChannelStorage,
    config: Config,
    channelPlugins: ReadonlySet<ChannelPluginFactory>,
    resourceSchemeRegistrations: ReadonlyMap<string, { prompt: string; open: ResourceSchemeOpenHandler }>,
  ) {
    this.ctx = ctx;
    this.config = config;
    this.model = model;
    this.logger = ctx.logger("runtime");
    this.logger.level = config.logLevel ?? 2;
    this.assets = assets;
    this.artifacts = artifacts;
    this.storage = storage;
    this.channelPlugins = channelPlugins;
    this.resourceSchemeRegistrations = resourceSchemeRegistrations;
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

  public async compact(scope: ChannelScope): Promise<string> {
    this.assertOpen();
    const runtime = await this.getOrCreate(scope);
    const session = this.sessions.get(runtime);
    if (!session) throw new Error("Runtime session is unavailable");
    let result = "压缩未完成。";
    await runtime.compact(async () => {
      const entries = await session.storage.read();
      if (messageCountSinceLastCompact(entries) < this.config.session.compact.minMessages) {
        result = "消息不足，未压缩。";
        return;
      }
      const compactCount = countEntries(entries, "compact");
      await session.compact();
      const updatedEntries = await session.storage.read();
      result = countEntries(updatedEntries, "compact") > compactCount ? "已压缩当前会话。" : "压缩未完成。";
    });
    return result;
  }

  public async archive(scope: ChannelScope, options: { noSummary?: boolean } = {}): Promise<string> {
    this.assertOpen();
    const key = scopeMapKey(scope);
    const runtime = await this.getOrCreate(scope);
    const session = this.sessions.get(runtime);
    if (!session) throw new Error("Runtime session is unavailable");
    await this.stopRuntime(key, runtime);
    if (this.runtimes.get(key) === runtime) this.runtimes.delete(key);
    try {
      await archiveSession({
        sessionsDir: session.sessionsDir,
        currentStorage: session.storage,
        noSummary: options.noSummary,
        executeCompactFn: session.summarize,
        logger: this.logger,
      });
    } catch (cause) {
      await this.getOrCreate(scope).catch((restoreCause) => {
        this.logger.warn("runtime.restore_failed", { scope, cause: restoreCause });
      });
      throw cause;
    }
    await this.getOrCreate(scope);
    return "已归档当前会话。";
  }

  public async clear(scope: ChannelScope): Promise<void> {
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
      const sessionsDir = join(await this.storage.getStoragePath(scope), "sessions");
      await fs.rm(sessionsDir, { recursive: true, force: true });
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
    try {
      await this.artifacts.createStore(scope).clear();
    } catch (cause) {
      this.logger.warn("artifact_clear_failed", { scope, cause });
      failure ??= cause;
    }
    if (failure) throw failure;
  }

  public async status(scope: ChannelScope): Promise<string> {
    this.assertOpen();
    const sessionsDir = join(await this.storage.getStoragePath(scope), "sessions");
    const active = (await listSessions(sessionsDir)).find((session) => session.isActive);
    if (!active) return "无会话记录。";
    const entries = await createJsonlStorage(active.path).read();
    const lastCompact = findLastCompact(entries);
    const lastEntry = entries.at(-1);
    const runtime = this.runtimes.get(scopeMapKey(scope));
    const failureCount = runtime ? (this.sessions.get(runtime)?.failureCount() ?? 0) : 0;
    return [
      `活动会话：${active.filename}`,
      `消息：${countEntries(entries, "message")}`,
      `压缩：${countEntries(entries, "compact")}`,
      `最后活跃：${lastEntry ? new Date(lastEntry.timestamp).toISOString() : "无"}`,
      `自上次压缩以来消息：${messageCountSinceLastCompact(entries)}`,
      `连续失败：${failureCount}`,
      `硬截断：${lastCompact?.data.summary === HARD_TRUNCATION_MESSAGE ? "是" : "否"}`,
      `文件大小：${formatBytes(active.size)}`,
    ].join("\n");
  }

  public async list(scope: ChannelScope): Promise<string> {
    this.assertOpen();
    const sessionsDir = join(await this.storage.getStoragePath(scope), "sessions");
    const sessions = await listSessions(sessionsDir);
    if (sessions.length === 0) return "无会话记录。";
    return (
      await Promise.all(
        sessions.map(async (session) => {
          const entries = await createJsonlStorage(session.path).read();
          return `${session.isActive ? "→ " : "  "}${session.filename} (${session.createdAt}, ${countEntries(entries, "message")} 条, ${formatBytes(session.size)})`;
        }),
      )
    ).join("\n");
  }

  public async reset(scope: ChannelScope): Promise<void> {
    return this.clear(scope);
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
    const basePath = resolve(this.ctx.baseDir, this.config.basePath || this.ctx.baseDir);
    const resolved = this.model.resolveChatModel(this.config.chatModel);
    const compactModel = this.config.session.compact.model
      ? this.model.resolveChatModel(this.config.session.compact.model)
      : resolved;
    const visionModel = resolveVisionModel(this.config.visionModel, this.model, this.logger, scope);
    const persona = await readPersona(basePath, this.logger);
    const summarize = (entries: readonly AgentEntry[]) => {
      const compact = findLastCompact(entries);
      return executeCompact({
        model: compactModel.model,
        persona,
        personaName: "Athena",
        previousMemory: compact?.data.summary ?? "",
        conversation: filterEntriesForCompression(compact ? entries.slice(entries.lastIndexOf(compact) + 1) : entries),
      });
    };
    let compact: (() => Promise<void>) | undefined;
    let runtime: ChannelRuntime | undefined;
    let failureCount = () => 0;
    const compactPlugin = createCompactPlugin({
      model: compactModel.model,
      threshold: this.config.session.compact.threshold,
      charTokenRatio: this.config.session.compact.charTokenRatio,
      minMessages: this.config.session.compact.minMessages,
      maxFailures: this.config.session.compact.maxFailures,
      contextLength: compactModel.entry.limit?.context,
      persona: async () => ({ name: "Athena", content: persona }),
      logger: this.logger,
      onCompact: (operation) => {
        compact = operation;
      },
      onCompactStatus: (getFailures) => {
        failureCount = getFailures;
      },
      scheduleAppend: (append) => (runtime ? runtime.compact(append) : append()),
    });
    const artifacts = this.artifacts.createStore(scope);
    const registrations = new Map(this.resourceSchemeRegistrations);
    const plugins = [
      compactPlugin,
      ...(await Promise.all([...this.channelPlugins].map((resolver) => resolver({ scope, bot, artifacts })))).filter(
        (plugin): plugin is AgentPlugin => plugin !== null,
      ),
    ];
    const sessionsDir = join(await this.storage.getStoragePath(scope), "sessions");
    await migrateOldSession(sessionsDir, this.logger);
    let activeSessionPath = await resolveActiveSession(sessionsDir);
    if (!activeSessionPath) activeSessionPath = await createNewSession(sessionsDir);
    const storage = createJsonlStorage(activeSessionPath);
    const options: ChannelRuntimeOptions = {
      config: {
        ...this.config,
        basePath,
      },
      scope,
      bot,
      will: createWillEngine(this.ctx, this.config.will),
      assets: this.assets.createStore(scope),
      artifacts,
      registrations,
      model: resolved.model,
      visionModel,
      imageBudget: this.config.imageInput ? ({ ...this.config.imageInput } as ImageBudget) : null,
      imageCapable: resolved.entry.modalities?.input?.includes("image") ?? false,
      idleTimeout: this.config.session.idle.timeout,
      compact,
      agentPlugins: plugins,
      storage,
    };
    runtime = new ChannelRuntime(this.ctx, options);
    try {
      await runtime.init();
    } catch (cause) {
      await runtime.stop().catch(() => undefined);
      throw cause;
    }
    if (!compact) throw new Error("Compact operation is unavailable");
    this.sessions.set(runtime, { compact, summarize, failureCount, sessionsDir, storage });
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

function resolveVisionModel(
  configured: string | undefined,
  model: ModelService,
  logger: Logger,
  scope: ChannelScope,
): LanguageModel | undefined {
  if (!configured) return undefined;
  try {
    const ref = model.resolveChatModel(configured);
    if (ref.entry.modalities?.input?.includes("image")) return ref.model;
    logger.warn("vision_model_without_image_input", { model: configured, scope });
    return undefined;
  } catch (cause) {
    logger.warn("vision_model_unavailable", {
      model: configured,
      scope,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return undefined;
  }
}

function findLastCompact(entries: readonly AgentEntry[]): AgentEntry<"compact"> | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!;
    if (entry.type === "compact") return entry as AgentEntry<"compact">;
  }
}

function countEntries(entries: readonly AgentEntry[], type: AgentEntry["type"]): number {
  return entries.filter((entry) => entry.type === type).length;
}

function messageCountSinceLastCompact(entries: readonly AgentEntry[]): number {
  const compact = findLastCompact(entries);
  const start = compact ? entries.lastIndexOf(compact) + 1 : 0;
  return countEntries(entries.slice(start), "message");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
