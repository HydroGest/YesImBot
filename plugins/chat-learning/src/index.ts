import { dirname, join, resolve } from "node:path";

import type {
  AgentEntry,
  AgentPlugin,
  AgentPluginRuntime,
  AgentStorage,
  PrepareStepContext,
} from "@yesimbot/agent-runtime";
import { createMessageEntry } from "@yesimbot/agent-runtime";
import type { ModelMessage } from "ai";
import { Context, Logger, Schema, Universal, type Command, type Session } from "koishi";
import { createMessage, isEvent, isMessage, type ChannelScope } from "koishi-plugin-yesimbot";

import { collectTurns, segmentTurns } from "./collector.js";
import { applyCorrections } from "./corrections.js";
import { createFeedbackStore, type FeedbackStore } from "./feedback.js";
import { sendChatLearningForward } from "./forward.js";
import {
  createEmptyGlobalRuleBank,
  createGlobalRuleStore,
  mergeLocalPatterns,
  selectGlobalPatterns,
  type GlobalRuleStore,
} from "./global-store.js";
import { createChatHistoryStore, type ChatHistoryStore } from "./history.js";
import { buildLinks } from "./links.js";
import { classifyPatternsWithModel, extractPatterns } from "./patterns.js";
import { buildPromptBlock, escapePromptText, estimateTokens } from "./projector.js";
import { createChatLearningStore } from "./store.js";
import type {
  ChatLearningConfig,
  ChatLearningState,
  GlobalPattern,
  LinkCorrection,
  LinkKind,
  ProactiveEventKind,
} from "./types.js";

export const Config: Schema<ChatLearningConfig> = Schema.object({
  maxExamples: Schema.number().min(1).max(10).default(4).description("每轮最多注入几个示例对话段"),
  maxMessagesPerExample: Schema.number().min(2).max(12).default(5).description("每个示例段最多包含的消息数"),
  maxHistoryAgeDays: Schema.number().min(1).max(365).default(30).description("学习历史的最大天数"),
  maxScanMessages: Schema.number().min(10).max(5000).default(1000).description("每次构建最多扫描的消息数"),
  refreshIntervalMinutes: Schema.number().min(1).max(1440).default(30).description("模型规律提炼的最小间隔分钟数"),
  maxPromptTokens: Schema.number().min(200).max(8000).default(2500).description("chat-learning 注入块的 token 预算"),
  maskNames: Schema.boolean().default(true).description("示例中把真实昵称替换为伪名"),
  blockedUserIds: Schema.array(Schema.string())
    .default([])
    .description("不参与学习、也不进入 few-shot 的 user id 黑名单"),
  blockedUserPatterns: Schema.array(Schema.string()).default([]).description("按昵称或 user id 子串过滤其他 bot"),
  autoBlockBotNames: Schema.boolean()
    .default(false)
    .description("启用常见 bot 名称自动过滤，例如 bot、机器人、小助手、官方"),
  observeAllChannels: Schema.boolean()
    .default(false)
    .description("在未启用 yesimbot 的频道也采集消息，用于跨群全局规律学习"),
  globalRulePath: Schema.string().default("").description("跨群全局规则文件路径；留空时放在频道根目录的上一级"),
  globalSyncIntervalMinutes: Schema.number().min(1).max(1440).default(60).description("跨群规则同步最小间隔分钟数"),
  minGlobalChannels: Schema.number().min(1).max(100).default(2).description("全局规则至少出现的频道数"),
  maxGlobalPatterns: Schema.number().min(1).max(50).default(8).description("每轮最多注入的全局规律数"),
  summaryModel: Schema.dynamic("registry.chatModels").description("用于提炼本群规律的模型；留空则只使用确定性统计规律"),
});

export default class ChatLearningPlugin {
  public static readonly name = "yesimbot-chat-learning";
  public static readonly usage = "从真实群聊中学习消息关系、回应规律与话题发起方式，并注入模型上下文。";
  public static readonly inject = ["yesimbot"];
  public static readonly Config: Schema<ChatLearningConfig> = Config;

  public readonly ctx: Context;
  public readonly config: ChatLearningConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin: (() => void) | undefined;
  private readonly commandDisposers = new Set<() => unknown>();
  private readonly feedbackStores = new Map<string, FeedbackStore>();
  private readonly historyStores = new Map<string, ChatHistoryStore>();
  private readonly rebuildHooks = new Map<string, () => void>();
  private readonly resetHooks = new Map<string, () => void>();
  private readonly globalStores = new Map<string, GlobalRuleStore>();
  private readonly globalBanks = new Map<string, ReturnType<typeof createEmptyGlobalRuleBank>>();
  private globalHistoryStore: ChatHistoryStore | undefined;
  private observeDispose: (() => void) | undefined;
  private globalSyncTimer: NodeJS.Timeout | undefined;

  public constructor(ctx: Context, config: ChatLearningConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.chat-learning");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeCommands();
    this.disposeAgentPlugin?.();
    this.logger.debug("chat_learning.start");
    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope }) => this.createAgentPlugin(scope));
    if (this.config.observeAllChannels) {
      this.observeDispose = this.ctx.middleware(async (session, next) => {
        try {
          await this.observeGlobal(session);
        } catch (cause) {
          this.logger.warn("chat_learning.observe_failed", {
            cause: cause instanceof Error ? cause.message : String(cause),
          });
        }
        return next();
      });
      const intervalMs = this.config.globalSyncIntervalMinutes * 60 * 1000;
      this.globalSyncTimer = setInterval(() => {
        void this.syncGlobalHistoryOnly().catch((cause) => {
          this.logger.warn("chat_learning.global_history_sync_failed", {
            cause: cause instanceof Error ? cause.message : String(cause),
          });
        });
      }, intervalMs);
      this.globalSyncTimer.unref?.();
    }
    this.registerCommands();
  }

  public async stop(): Promise<void> {
    this.disposeCommands();
    this.observeDispose?.();
    this.observeDispose = undefined;
    if (this.globalSyncTimer) {
      clearInterval(this.globalSyncTimer);
      this.globalSyncTimer = undefined;
    }
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    this.feedbackStores.clear();
    this.historyStores.clear();
    this.rebuildHooks.clear();
    this.resetHooks.clear();
    this.globalStores.clear();
    this.globalBanks.clear();
    this.globalHistoryStore = undefined;
    this.logger.debug("chat_learning.stop");
  }

  private async createAgentPlugin(scope: ChannelScope): Promise<AgentPlugin> {
    const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
    const store = createChatLearningStore(join(storagePath, "chat-learning.json"));
    await store.init();
    const feedbackStore = await this.feedbackStoreFor(scope);
    const historyStore = await this.historyStoreFor(scope);
    const { store: globalStore, path: globalPath } = await this.globalStoreFor(storagePath);
    const key = scopeKey(scope);
    const config = this.config;
    const logger = this.logger;

    let runtimeStorage: AgentStorage<AgentEntry> | undefined;
    let state = store.read();
    let learnedEntries: readonly AgentEntry[] = [];
    let globalPatterns: readonly GlobalPattern[] = [];
    let lastGlobalSyncAt = 0;
    let dirty = true;
    let building: Promise<void> | undefined;
    let injectedTurn: string | undefined;
    let currentEvent: ProactiveEventKind | undefined;
    let lastModelEnrichAt = state?.builtAt ?? 0;

    logger.debug("chat_learning.channel_plugin_created", {
      scope,
      key,
      cachedTurns: state?.turns.length ?? 0,
      cachedLinks: state?.links.length ?? 0,
    });

    const rebuild = async (allowModel: boolean): Promise<void> => {
      if (building) return building;
      const task = (async () => {
        if (!runtimeStorage) return;
        const entries = learnedEntries;
        const corrections = feedbackStore.read();
        logger.debug("chat_learning.rebuild_start", {
          scope,
          allowModel,
          entries: entries.length,
          corrections: corrections.length,
        });
        const next = buildSnapshot(entries, config, scope, corrections);
        logger.debug("chat_learning.rebuild_done", {
          scope,
          turns: next.turns.length,
          links: next.links.length,
          segments: next.segments.length,
          responsePatterns: next.responsePatterns.length,
          initiationPatterns: next.initiationPatterns.length,
        });
        const refreshMs = config.refreshIntervalMinutes * 60 * 1000;
        const shouldEnrich =
          allowModel && config.summaryModel !== undefined && Date.now() - lastModelEnrichAt >= refreshMs;
        state = next;
        dirty = false;
        await store.update(next);
        const globalSyncMs = config.globalSyncIntervalMinutes * 60 * 1000;
        if (Date.now() - lastGlobalSyncAt >= globalSyncMs) {
          await this.syncGlobalFromHistory(globalPath, globalStore, config);
          const currentBank = this.globalBanks.get(globalPath) ?? globalStore.read();
          const mergedBank = mergeLocalPatterns(
            currentBank,
            next.responsePatterns,
            next.initiationPatterns,
            key,
            Date.now(),
          );
          await globalStore.update(mergedBank);
          this.globalBanks.set(globalPath, mergedBank);
          globalPatterns = [
            ...selectGlobalPatterns(mergedBank, "response", config.minGlobalChannels, config.maxGlobalPatterns),
          ];
          lastGlobalSyncAt = Date.now();
          logger.debug("chat_learning.global_sync", {
            scope,
            globalPath,
            globalPatterns: mergedBank.patterns.length,
          });
        }
        if (!shouldEnrich) return;
        const enriched = await enrichWithModel(next, config, this.ctx, logger);
        if (shouldEnrich) lastModelEnrichAt = Date.now();
        state = enriched;
        await store.update(enriched);
        logger.debug("chat_learning.model_enrich_done", {
          scope,
          responsePatterns: enriched.responsePatterns.length,
          initiationPatterns: enriched.initiationPatterns.length,
        });
      })().finally(() => {
        building = undefined;
      });
      building = task;
      return task;
    };

    const scheduleRebuild = (): void => {
      dirty = true;
      void rebuild(false).catch((cause) => {
        logger.warn("chat_learning.rebuild_failed", {
          scope,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      });
    };
    this.rebuildHooks.set(key, scheduleRebuild);
    this.resetHooks.set(key, () => {
      learnedEntries = [];
      dirty = true;
      void rebuild(false).catch((cause) => {
        logger.warn("chat_learning.reset_rebuild_failed", {
          scope,
          cause: cause instanceof Error ? cause.message : String(cause),
        });
      });
    });

    return {
      name: "chat-learning",
      async init(runtime: AgentPluginRuntime) {
        runtimeStorage = runtime.storage;
        learnedEntries = await historyStore.read();
        if (learnedEntries.length === 0) {
          learnedEntries = await runtimeStorage.read();
          await historyStore.append(learnedEntries);
        }
        await rebuild(false);
        logger.debug("chat_learning.runtime_init", {
          scope,
          turns: state?.turns.length ?? 0,
          links: state?.links.length ?? 0,
        });
        if (config.summaryModel !== undefined) {
          void rebuild(true);
        }
      },
      async onAppend(entries: readonly AgentEntry[]) {
        logger.debug("chat_learning.on_append", {
          scope,
          entries: entries.length,
        });
        learnedEntries = [...learnedEntries, ...entries];
        await historyStore.append(entries);
        dirty = true;
        scheduleRebuild();
        return [...entries];
      },
      toModelMessages(message) {
        if (isEvent(message)) {
          currentEvent = proactiveEventKind(message.data.eventType);
          logger.debug("chat_learning.event_seen", {
            scope,
            eventType: message.data.eventType,
            kind: currentEvent,
          });
        }
        return undefined;
      },
      prepareStep: async (messages: readonly ModelMessage[], context: PrepareStepContext) => {
        if (injectedTurn === context.turnId) return messages;
        injectedTurn = context.turnId;
        if (dirty) await rebuild(false);
        const bank = this.globalBanks.get(globalPath) ?? globalStore.read();
        globalPatterns = [
          ...selectGlobalPatterns(
            bank,
            currentEvent ? "initiation" : "response",
            config.minGlobalChannels,
            config.maxGlobalPatterns,
          ),
        ];
        const block = buildPromptBlock(state, currentEvent, config, globalPatterns);
        logger.debug("chat_learning.prepare_step", {
          scope,
          turnId: context.turnId,
          step: context.stepNumber,
          dirty,
          eventKind: currentEvent,
          stateTurns: state?.turns.length ?? 0,
          stateLinks: state?.links.length ?? 0,
          blockLength: block?.length ?? 0,
        });
        return block ? [{ role: "system", content: block }, ...messages] : messages;
      },
      stop: () => {
        this.rebuildHooks.delete(key);
        this.resetHooks.delete(key);
        logger.debug("chat_learning.channel_plugin_stop", { scope });
      },
    } satisfies AgentPlugin;
  }

  private registerCommands(): void {
    const track = (command: Command): void => {
      if (typeof command.dispose === "function") {
        this.commandDisposers.add(() => command.dispose());
      }
    };

    track(
      this.ctx
        .command("yesimbot.chat-learning.status", "查看 chat-learning 当前学习状态", { authority: 4 })
        .action(async ({ session }) => {
          try {
            const scope = scopeOf(session);
            if (!scope) return "无法获取当前频道信息";
            const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
            const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
            await stateStore.init();
            const state = stateStore.read();
            const feedback = await this.feedbackStoreFor(scope);
            const corrections = feedback.read();
            const global = await this.globalStoreFor(storagePath);
            const globalPatterns = global.store.read().patterns.length;
            this.logger.debug("chat_learning.status", {
              scope,
              turns: state?.turns.length ?? 0,
              links: state?.links.length ?? 0,
              responsePatterns: state?.responsePatterns.length ?? 0,
              initiationPatterns: state?.initiationPatterns.length ?? 0,
              corrections: corrections.length,
              globalPatterns,
            });
            const text = [
              `chat-learning ${scope.platform}:${scope.channelId}`,
              `turns=${state?.turns.length ?? 0}`,
              `links=${state?.links.length ?? 0}`,
              `responsePatterns=${state?.responsePatterns.length ?? 0}`,
              `initiationPatterns=${state?.initiationPatterns.length ?? 0}`,
              `corrections=${corrections.length}`,
              `globalPatterns=${globalPatterns}`,
              `state=${join(storagePath, "chat-learning.json")}`,
            ].join("\n");
            return await this.replyLong(session, text, text);
          } catch (cause) {
            this.logger.warn("chat_learning.status_failed", {
              cause: cause instanceof Error ? cause.message : String(cause),
            });
            return `status 失败：${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }),
    );

    track(
      this.ctx
        .command("yesimbot.chat-learning.preview", "预览即将注入模型的学习上下文", { authority: 4 })
        .option("event", "<event> global-brain|schedule|chat-learning")
        .action(async ({ session, options }) => {
          try {
            const scope = scopeOf(session);
            if (!scope) return "无法获取当前频道信息";
            const rawEvent = options?.event;
            const eventKind = rawEvent === undefined ? undefined : parseEventKind(String(rawEvent));
            if (rawEvent !== undefined && eventKind === undefined) {
              return "event 必须是 global-brain|schedule|chat-learning";
            }
            const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
            const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
            await stateStore.init();
            const state = stateStore.read();
            const block = buildPromptBlock(state, eventKind, this.config);
            if (!block) return "当前没有可注入的学习上下文";
            this.logger.debug("chat_learning.preview", {
              scope,
              eventKind,
              tokens: estimateTokens(block),
              blockLength: block.length,
            });
            const rawText = `token≈${estimateTokens(block)}\n\n${block}`;
            const fallbackText = `token≈${estimateTokens(block)}\n\n${escapePromptText(block)}`;
            return await this.replyLong(session, rawText, fallbackText);
          } catch (cause) {
            this.logger.warn("chat_learning.preview_failed", {
              cause: cause instanceof Error ? cause.message : String(cause),
            });
            return `preview 失败：${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }),
    );

    track(
      this.ctx
        .command("yesimbot.chat-learning.reset", "清空 chat-learning 学习数据", { authority: 4 })
        .action(async ({ session }) => {
          try {
            const scope = scopeOf(session);
            if (!scope) return "无法获取当前频道信息";
            const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
            const history = await this.historyStoreFor(scope);
            await history.clear();
            const feedback = await this.feedbackStoreFor(scope);
            await feedback.clear();
            const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
            await stateStore.init();
            await stateStore.clear();
            this.resetHooks.get(scopeKey(scope))?.();
            this.logger.debug("chat_learning.reset", { scope });
            return "已清空 chat-learning 学习数据，不影响会话历史。";
          } catch (cause) {
            this.logger.warn("chat_learning.reset_failed", {
              cause: cause instanceof Error ? cause.message : String(cause),
            });
            return `reset 失败：${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }),
    );

    track(
      this.ctx
        .command("yesimbot.chat-learning.link <from> <to> <kind>", "手动添加消息关系", { authority: 4 })
        .option("confidence", "<confidence> 置信度 0-1")
        .action(async ({ session, options }, from, to, kind) => {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          if (typeof from !== "string" || typeof to !== "string" || typeof kind !== "string") {
            return "用法：yesimbot.chat-learning.link <from> <to> <kind> [--confidence 0-1]";
          }
          const linkKind = parseLinkKind(kind);
          if (!linkKind) return "kind 必须是 quote|reply|at|adjacent|entity|*";
          const confidence = parseConfidence(options?.confidence);
          if (confidence === undefined) return "--confidence 必须是 0-1 之间的数字";
          const feedback = await this.feedbackStoreFor(scope);
          const correction = await feedback.append({ action: "add", from, to, kind: linkKind, confidence });
          this.logger.debug("chat_learning.link_added", { scope, correction });
          this.rebuildHooks.get(scopeKey(scope))?.();
          return `已添加纠错 ${correction.id}`;
        }),
    );

    track(
      this.ctx
        .command("yesimbot.chat-learning.unlink <from> <to> [kind]", "手动移除消息关系", { authority: 4 })
        .action(async ({ session }, from, to, kind) => {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          if (typeof from !== "string" || typeof to !== "string") {
            return "用法：yesimbot.chat-learning.unlink <from> <to> [kind]";
          }
          const linkKind = kind ? parseLinkKind(kind) : "*";
          if (!linkKind) return "kind 必须是 quote|reply|at|adjacent|entity|*";
          const feedback = await this.feedbackStoreFor(scope);
          const correction = await feedback.append({ action: "remove", from, to, kind: linkKind });
          this.logger.debug("chat_learning.link_removed", { scope, correction });
          this.rebuildHooks.get(scopeKey(scope))?.();
          return `已添加纠错 ${correction.id}`;
        }),
    );
  }

  private disposeCommands(): void {
    for (const dispose of this.commandDisposers) {
      try {
        dispose();
      } catch {}
    }
    this.commandDisposers.clear();
  }

  private async feedbackStoreFor(scope: ChannelScope): Promise<FeedbackStore> {
    const key = scopeKey(scope);
    const existing = this.feedbackStores.get(key);
    if (existing) return existing;
    const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
    const store = createFeedbackStore(join(storagePath, "chat-learning-feedback.jsonl"));
    await store.init();
    this.feedbackStores.set(key, store);
    return store;
  }

  private async historyStoreFor(scope: ChannelScope): Promise<ChatHistoryStore> {
    const key = scopeKey(scope);
    const existing = this.historyStores.get(key);
    if (existing) return existing;
    const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
    const store = createChatHistoryStore(join(storagePath, "chat-learning-history.jsonl"));
    await store.init();
    this.historyStores.set(key, store);
    return store;
  }

  private async globalStoreFor(_storagePath: string): Promise<{ store: GlobalRuleStore; path: string }> {
    const path = this.defaultGlobalPath();
    const existing = this.globalStores.get(path);
    if (existing) return { store: existing, path };
    const store = createGlobalRuleStore(path);
    await store.init();
    this.globalStores.set(path, store);
    this.globalBanks.set(path, store.read());
    return { store, path };
  }

  private defaultGlobalPath(): string {
    const configured = this.config.globalRulePath?.trim();
    return configured
      ? resolve(this.ctx.baseDir, configured)
      : join(this.ctx.baseDir, "data/yesimbot", "chat-learning-global.json");
  }

  private async globalHistoryStoreFor(): Promise<ChatHistoryStore> {
    if (this.globalHistoryStore) return this.globalHistoryStore;
    const path = join(dirname(this.defaultGlobalPath()), "chat-learning-global-history.jsonl");
    const store = createChatHistoryStore(path);
    await store.init();
    this.globalHistoryStore = store;
    return store;
  }

  private async observeGlobal(session: Session): Promise<void> {
    if (
      session.type !== "message-created" ||
      !session.platform ||
      !session.selfId ||
      !session.channelId ||
      !session.messageId ||
      !Array.isArray(session.elements) ||
      session.userId === session.selfId
    ) {
      return;
    }
    const store = await this.globalHistoryStoreFor();
    const channelName = session.event.channel?.name;
    const userName = session.event.user?.name ?? session.author?.name;
    const record = createMessage({
      platform: session.platform,
      selfId: session.selfId,
      timestamp: session.timestamp,
      channel: {
        id: session.channelId,
        type: session.isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
        ...(channelName === undefined ? {} : { name: channelName }),
      },
      user: {
        id: session.userId ?? session.author?.id ?? "",
        ...(userName === undefined ? {} : { name: userName }),
      },
      messageId: session.messageId,
      elements: session.elements,
    });
    const entry = createMessageEntry(record, {
      id: `global-${session.messageId}-${session.timestamp}`,
      timestamp: session.timestamp,
    });
    await store.append([entry]);
    this.logger.debug("chat_learning.observe_global", {
      scope: scopeOf(session),
      messageId: session.messageId,
    });
  }

  private async syncGlobalHistoryOnly(): Promise<void> {
    const { store, path } = await this.globalStoreFor("");
    await this.syncGlobalFromHistory(path, store, this.config);
  }

  private async syncGlobalFromHistory(
    globalPath: string,
    globalStore: GlobalRuleStore,
    config: ChatLearningConfig,
  ): Promise<void> {
    const history = await this.globalHistoryStoreFor();
    const entries = await history.read();
    if (entries.length === 0) return;

    const groups = new Map<string, AgentEntry[]>();
    for (const entry of entries) {
      const key = scopeKeyFromEntry(entry);
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }

    let bank = this.globalBanks.get(globalPath) ?? globalStore.read();
    for (const [scopeKeyValue, groupEntries] of groups) {
      const turns = collectTurns(groupEntries, {
        blockedUserIds: config.blockedUserIds,
        blockedUserPatterns: config.blockedUserPatterns,
        autoBlockBotNames: config.autoBlockBotNames,
      });
      const segments = segmentTurns(turns);
      const patterns = extractPatterns(segments);
      bank = mergeLocalPatterns(
        bank,
        patterns.responsePatterns,
        patterns.initiationPatterns,
        scopeKeyValue,
        Date.now(),
      );
    }

    await globalStore.update(bank);
    this.globalBanks.set(globalPath, bank);
    await history.clear();
    this.logger.debug("chat_learning.global_history_sync", {
      globalPath,
      groups: groups.size,
      entries: entries.length,
      globalPatterns: bank.patterns.length,
    });
  }

  private async replyLong(
    session: Session | undefined,
    forwardText: string,
    fallbackText: string,
  ): Promise<string | undefined> {
    if (!session || forwardText.length <= 200) return fallbackText;
    try {
      if (await sendChatLearningForward(session, forwardText)) {
        this.logger.debug("chat_learning.forward_sent", {
          scope: scopeOf(session),
          chars: forwardText.length,
        });
        return undefined;
      }
    } catch (cause) {
      this.logger.warn("chat_learning.forward_failed", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return fallbackText;
  }
}

function buildSnapshot(
  entries: readonly AgentEntry[],
  config: ChatLearningConfig,
  scope: ChannelScope,
  corrections: readonly LinkCorrection[],
): ChatLearningState {
  const now = Date.now();
  const turns = collectTurns(entries, {
    maxHistoryAgeDays: config.maxHistoryAgeDays,
    maxScanMessages: config.maxScanMessages,
    now,
    blockedUserIds: config.blockedUserIds,
    blockedUserPatterns: config.blockedUserPatterns,
    autoBlockBotNames: config.autoBlockBotNames,
  });
  const segments = segmentTurns(turns);
  const links = applyCorrections(buildLinks(turns, { selfId: scope.selfId }), turns, corrections);
  const patterns = extractPatterns(segments);
  const lastEntry = [...entries].reverse().find((entry) => entry.type === "message");
  return {
    lastEntryId: lastEntry?.id,
    builtAt: now,
    turns,
    links,
    segments,
    responsePatterns: patterns.responsePatterns,
    initiationPatterns: patterns.initiationPatterns,
  };
}

async function enrichWithModel(
  state: ChatLearningState,
  config: ChatLearningConfig,
  ctx: Context,
  logger: Logger,
): Promise<ChatLearningState> {
  if (!config.summaryModel) return state;
  try {
    const ref = ctx.yesimbot.model.resolveChatModel(config.summaryModel);
    const patterns = await classifyPatternsWithModel(ref.model, state.turns, state.segments);
    if (!patterns) return state;
    return {
      ...state,
      responsePatterns: patterns.responsePatterns,
      initiationPatterns: patterns.initiationPatterns,
      builtAt: Date.now(),
    };
  } catch (cause) {
    logger.warn("chat_learning.model_enrich_failed", {
      model: config.summaryModel,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return state;
  }
}

function proactiveEventKind(eventType: string): ProactiveEventKind | undefined {
  if (eventType.startsWith("global-brain")) return "global-brain";
  if (eventType === "schedule.due") return "schedule";
  return undefined;
}

function scopeOf(session: Session | undefined): ChannelScope | null {
  if (!session?.platform || !session.selfId || !session.channelId) return null;
  return {
    type: session.isDirect ? "direct" : "shared",
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
  };
}

function scopeKey(scope: ChannelScope): string {
  return `${scope.type}:${scope.platform}:${scope.selfId}:${scope.channelId}`;
}

function scopeKeyFromEntry(entry: AgentEntry): string | undefined {
  if (entry.type !== "message" || !isMessage(entry.data)) return undefined;
  const data = entry.data.data;
  return `${data.channel.type === Universal.Channel.Type.DIRECT ? "direct" : "shared"}:${data.platform}:${data.selfId}:${data.channel.id}`;
}

const LINK_KINDS = new Set<LinkKind | "*">(["quote", "reply", "at", "adjacent", "entity", "*"]);

function parseLinkKind(value: string): LinkKind | "*" | undefined {
  return LINK_KINDS.has(value as LinkKind | "*") ? (value as LinkKind | "*") : undefined;
}

function parseEventKind(value: string): ProactiveEventKind | undefined {
  return value === "global-brain" || value === "schedule" || value === "chat-learning" ? value : undefined;
}

function parseConfidence(value: unknown): number | undefined {
  if (value === undefined) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
}
