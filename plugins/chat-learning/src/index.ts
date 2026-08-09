import { dirname, join, resolve } from "node:path";

import type { AgentEntry, AgentPlugin, AgentPluginRuntime, AgentStorage, PrepareStepContext } from "@yesimbot/agent-runtime";
import { createMessageEntry } from "@yesimbot/agent-runtime";
import type { ModelMessage } from "ai";
import { Context, Logger, Schema, Universal, type Bot, type Command, type Session } from "koishi";
import { createMessage, isMessage, type DeliveredPayload } from "koishi-plugin-yesimbot";

/** Internal scope that always carries selfId for keying purposes. */
type FullScope = { readonly type: "shared" | "direct"; readonly platform: string; readonly selfId: string; readonly channelId: string };

import { buildLocalChainPatterns } from "./chains.js";
import { collectTurns, segmentTurns } from "./collector.js";
import { applyCorrections } from "./corrections.js";
import { buildPatternEmbeddingMap } from "./embedding.js";
import { createFeedbackStore, type FeedbackStore } from "./feedback.js";
import { sendChatLearningForward } from "./forward.js";
import {
  createEmptyGlobalRuleBank,
  createGlobalRuleStore,
  mergeLocalPatterns,
  selectGlobalChains,
  selectGlobalPatterns,
  selectRelevantGlobalChains,
  type GlobalRuleStore,
} from "./global-store.js";
import { createChatHistoryStore, type ChatHistoryStore } from "./history.js";
import { buildLinks } from "./links.js";
import { classifyPatternsWithModel } from "./patterns.js";
import { detectProactiveEvent } from "./proactive.js";
import { buildPromptBlock, escapePromptText, estimateTokens } from "./projector.js";
import { createReflectionStore, type ReflectionRecord, type ReflectionScore, type ReflectionStore } from "./reflection-store.js";
import { reflectOnSentMessage } from "./reflection.js";
import { createChatLearningStore } from "./store.js";
import { formatReflectionTarget } from "./text.js";
import type { ChatLearningConfig, ChatLearningState, GlobalChainPattern, GlobalPattern, LinkCorrection, LinkKind, ProactiveEventKind } from "./types.js";

export const Config: Schema<ChatLearningConfig> = Schema.object({
  maxExamples: Schema.number().min(1).max(10).default(4).description("每轮最多注入几个示例对话段"),
  maxMessagesPerExample: Schema.number().min(2).max(12).default(5).description("每个示例段最多包含的消息数"),
  maxHistoryAgeDays: Schema.number().min(1).max(365).default(30).description("学习历史的最大天数"),
  maxScanMessages: Schema.number().min(10).max(5000).default(1000).description("每次构建最多扫描的消息数"),
  refreshIntervalMinutes: Schema.number().min(1).max(1440).default(30).description("模型规律提炼的最小间隔分钟数"),
  maxPromptTokens: Schema.number().min(200).max(8000).default(2500).description("chat-learning 注入块的 token 预算"),
  maskNames: Schema.boolean().default(true).description("示例中把真实昵称替换为伪名"),
  blockedUserIds: Schema.array(Schema.string()).default([]).description("不参与学习、也不进入 few-shot 的 user id 黑名单"),
  blockedUserPatterns: Schema.array(Schema.string()).default([]).description("按昵称或 user id 子串过滤其他 bot"),
  autoBlockBotNames: Schema.boolean().default(false).description("启用常见 bot 名称自动过滤，例如 bot、机器人、小助手、官方"),
  observeAllChannels: Schema.boolean().default(false).description("在未启用 yesimbot 的频道也采集消息，用于跨群全局规律学习"),
  globalRulePath: Schema.string().default("").description("跨群全局规则文件路径；留空时放在频道根目录的上一级"),
  globalSyncIntervalMinutes: Schema.number().min(1).max(1440).default(60).description("跨群规则同步最小间隔分钟数"),
  minGlobalChannels: Schema.number().min(1).max(100).default(2).description("全局规则至少出现的频道数"),
  maxGlobalPatterns: Schema.number().min(1).max(50).default(8).description("每轮最多注入的全局规律数"),
  summaryModel: Schema.dynamic("registry.chatModels").description(
    "用于提炼本群规律的模型；留空则使用 Core 默认 chat 模型，没有可用模型时不生成 local_patterns",
  ),
  embeddingModel: Schema.dynamic("registry.embeddingModels").default("").description("用于语义归并全局规律的 embedding 模型；留空则不使用 embedding"),
  embeddingSimilarity: Schema.number().min(0).max(1).default(0.92).description("embedding 语义归并阈值，越高要求越相似"),
  maxModelThreads: Schema.number().min(1).max(10).default(3).description("每次模型标注最多使用几条完整对话线程"),
  maxModelThreadMessages: Schema.number().min(4).max(100).default(30).description("每条线程最多送入模型的消息数"),
  reflectionModel: Schema.dynamic("registry.chatModels").default("").description("可选：用独立模型评价 bot 最近发言并生成风格反思；留空则关闭"),
  maxInjectedReflections: Schema.number().min(1).max(10).default(3).description("每次注入提示词末尾的最近反思条数"),
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
  private readonly syncHooks = new Map<string, () => Promise<void>>();
  private readonly reflectHooks = new Map<string, (payload: DeliveredPayload) => Promise<void>>();
  private readonly reflectionStores = new Map<string, ReflectionStore>();
  private readonly reflectionQueues = new Map<string, Promise<void>>();
  private readonly reflectionPending = new Map<string, DeliveredPayload>();
  private readonly reflectionLatestMessage = new Map<string, string>();
  private readonly globalStores = new Map<string, GlobalRuleStore>();
  private readonly globalBanks = new Map<string, ReturnType<typeof createEmptyGlobalRuleBank>>();
  private globalHistoryStore: ChatHistoryStore | undefined;
  private observeDispose: (() => void) | undefined;
  private globalSyncTimer: NodeJS.Timeout | undefined;

  public constructor(ctx: Context, config: ChatLearningConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.chat-learning");
    this.logger.level = ctx.yesimbot.config.logLevel ?? 2;
    ctx.on("yesimbot/delivered", (payload) => {
      void this.onDelivered(payload).catch((cause) => {
        this.logger.warn("chat_learning.delivered_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
      });
    });
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  private async onDelivered(payload: DeliveredPayload): Promise<void> {
    const scope: FullScope = {
      type: payload.channel.type === Universal.Channel.Type.DIRECT ? "direct" : "shared",
      platform: payload.platform,
      selfId: payload.selfId,
      channelId: payload.channel.id,
    };
    const hook = this.reflectHooks.get(scopeKey(scope));
    if (hook) await hook(payload);
  }

  public async start(): Promise<void> {
    this.disposeCommands();
    this.disposeAgentPlugin?.();
    this.logger.debug("chat_learning.start");
    this.disposeAgentPlugin = this.ctx.yesimbot.agent.use({ setup: (scope, bot) => this.createAgentPlugin({ ...scope, selfId: bot.selfId }) });
    if (this.config.observeAllChannels) {
      this.observeDispose = this.ctx.middleware(async (session, next) => {
        try {
          await this.observeGlobal(session);
        } catch (cause) {
          this.logger.warn("chat_learning.observe_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
        }
        return next();
      });
      const intervalMs = this.config.globalSyncIntervalMinutes * 60 * 1000;
      this.globalSyncTimer = setInterval(() => {
        void this.syncGlobalHistoryOnly().catch((cause) => {
          this.logger.warn("chat_learning.global_history_sync_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
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
    this.syncHooks.clear();
    this.reflectHooks.clear();
    this.reflectionStores.clear();
    this.reflectionQueues.clear();
    this.reflectionPending.clear();
    this.reflectionLatestMessage.clear();
    this.globalStores.clear();
    this.globalBanks.clear();
    this.globalHistoryStore = undefined;
    this.logger.debug("chat_learning.stop");
  }

  private async createAgentPlugin(scope: FullScope): Promise<AgentPlugin> {
    const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
    const store = createChatLearningStore(join(storagePath, "chat-learning.json"));
    await store.init();
    const feedbackStore = await this.feedbackStoreFor(scope);
    const historyStore = await this.historyStoreFor(scope);
    const reflectionStore = await this.reflectionStoreFor(scope);
    const { store: globalStore, path: globalPath } = await this.globalStoreFor(storagePath);
    const key = scopeKey(scope);
    const config = this.config;
    const logger = this.logger;
    const ctx = this.ctx;

    let runtimeStorage: AgentStorage<AgentEntry> | undefined;
    let state = store.read();
    let learnedEntries: readonly AgentEntry[] = [];
    let globalPatterns: readonly GlobalPattern[] = [];
    let globalStylePatterns: readonly GlobalPattern[] = [];
    let globalChains: readonly GlobalChainPattern[] = [];
    let lastGlobalSyncAt = 0;
    let dirty = true;
    let building: Promise<void> | undefined;
    let injectedTurn: string | undefined;
    let currentEvent: ProactiveEventKind | undefined;
    let lastModelEnrichAt = state?.builtAt ?? 0;

    logger.debug("chat_learning.channel_plugin_created", { scope, key, cachedTurns: state?.turns.length ?? 0, cachedLinks: state?.links.length ?? 0 });

    const rebuild = async (allowModel: boolean): Promise<void> => {
      if (building) return building;
      const task = (async () => {
        if (!runtimeStorage) return;
        const historyAgeMs = config.maxHistoryAgeDays * 24 * 60 * 60 * 1000;
        while (true) {
          dirty = false;
          const entries = learnedEntries;
          const corrections = feedbackStore.read();
          logger.debug("chat_learning.rebuild_start", { scope, allowModel, entries: entries.length, corrections: corrections.length });
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
          const shouldEnrich = allowModel && resolveChatLearningModelId(this.ctx, config) !== undefined && Date.now() - lastModelEnrichAt >= refreshMs;
          let current = next;
          if (shouldEnrich) {
            current = await enrichWithModel(next, config, this.ctx, logger);
            lastModelEnrichAt = Date.now();
          } else if (state) {
            current = { ...next, responsePatterns: state.responsePatterns, initiationPatterns: state.initiationPatterns };
          }
          state = current;
          await store.update(current);
          const retained = await historyStore.trim(historyAgeMs, config.maxScanMessages);
          if (!dirty) learnedEntries = retained;
          const globalSyncMs = config.globalSyncIntervalMinutes * 60 * 1000;
          if (Date.now() - lastGlobalSyncAt >= globalSyncMs) {
            await this.syncGlobalFromHistory(globalPath, globalStore, config);
            const currentBank = this.globalBanks.get(globalPath) ?? globalStore.read();
            const chainPatterns = buildLocalChainPatterns(current.segments, current.links, current.responsePatterns, current.initiationPatterns);
            const localEmbeddings = await buildPatternEmbeddingMap(this.ctx, config, current.responsePatterns, current.initiationPatterns);
            const mergedBank = mergeLocalPatterns(currentBank, current.responsePatterns, current.initiationPatterns, chainPatterns, key, Date.now(), {
              localEmbeddings,
              embeddingSimilarity: config.embeddingSimilarity,
            });
            await globalStore.update(mergedBank);
            this.globalBanks.set(globalPath, mergedBank);
            globalPatterns = [
              ...selectGlobalPatterns(mergedBank, "response", config.minGlobalChannels, config.maxGlobalPatterns),
            ];
            globalStylePatterns = [
              ...selectGlobalPatterns(mergedBank, "response", config.minGlobalChannels, config.maxGlobalPatterns),
              ...selectGlobalPatterns(mergedBank, "initiation", config.minGlobalChannels, config.maxGlobalPatterns),
            ];
            globalChains = [
              ...selectGlobalChains(mergedBank, config.minGlobalChannels, config.maxGlobalPatterns),
            ];
            lastGlobalSyncAt = Date.now();
            logger.debug("chat_learning.global_sync", {
              scope,
              globalPath,
              globalPatterns: mergedBank.patterns.length,
              globalChains: mergedBank.chains.length,
            });
          }
          if (shouldEnrich) {
            logger.debug("chat_learning.model_enrich_done", {
              scope,
              responsePatterns: current.responsePatterns.length,
              initiationPatterns: current.initiationPatterns.length,
            });
          }
          if (!dirty) break;
        }
      })().finally(() => {
        building = undefined;
      });
      building = task;
      return task;
    };

    const scheduleRebuild = (): void => {
      dirty = true;
      void rebuild(false).catch((cause) => {
        logger.warn("chat_learning.rebuild_failed", { scope, cause: cause instanceof Error ? cause.message : String(cause) });
      });
    };
    this.rebuildHooks.set(key, scheduleRebuild);
    this.syncHooks.set(key, async () => {
      lastModelEnrichAt = 0;
      lastGlobalSyncAt = 0;
      await rebuild(true);
      logger.debug("chat_learning.sync_forced", { scope, globalPath });
    });
    this.resetHooks.set(key, () => {
      learnedEntries = [];
      dirty = true;
      void rebuild(false).catch((cause) => {
        logger.warn("chat_learning.reset_rebuild_failed", { scope, cause: cause instanceof Error ? cause.message : String(cause) });
      });
    });

    this.reflectHooks.set(key, async (payload) => {
      const modelId = config.reflectionModel?.trim();
      if (!modelId) return;
      this.reflectionLatestMessage.set(key, payload.messageId);
      this.reflectionPending.set(key, payload);
      const existing = this.reflectionQueues.get(key);
      if (existing) return;

      const task = (async () => {
        while (true) {
          const current = this.reflectionPending.get(key);
          if (!current) break;
          this.reflectionPending.delete(key);
          if (this.reflectionLatestMessage.get(key) !== current.messageId) continue;
          const styleBlock = buildPromptBlock(
            state,
            undefined,
            config,
            globalPatterns,
            globalChains,
            globalStylePatterns,
          );
          if (!styleBlock) continue;
          try {
            const ref = ctx.yesimbot.model.resolveChatModel(modelId);
            const next = await reflectOnSentMessage(ref.model, styleBlock, current.text);
            if (next) {
              await reflectionStore.append({
                source: "auto",
                text: current.text,
                reflection: next,
                score: undefined,
                annotation: undefined,
                messageId: current.messageId,
                turnId: current.turnId,
              });
              logger.debug("chat_learning.reflection_saved", { scope, model: modelId, messageId: current.messageId });
            }
          } catch (cause) {
            logger.warn("chat_learning.reflection_failed", { model: modelId, cause: cause instanceof Error ? cause.message : String(cause) });
          }
        }
      })().finally(() => {
        this.reflectionQueues.delete(key);
      });
      this.reflectionQueues.set(key, task);
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
        learnedEntries = await historyStore.trim(config.maxHistoryAgeDays * 24 * 60 * 60 * 1000, config.maxScanMessages);
        await rebuild(false);
        logger.debug("chat_learning.runtime_init", { scope, turns: state?.turns.length ?? 0, links: state?.links.length ?? 0 });
        if (resolveChatLearningModelId(ctx, config) !== undefined) {
          void rebuild(true);
        }
      },
      async onAppend(entries: readonly AgentEntry[]) {
        const eventKind = detectProactiveEvent(entries);
        currentEvent = eventKind;
        logger.debug("chat_learning.on_append", { scope, entries: entries.length, eventKind });
        learnedEntries = [...learnedEntries, ...entries];
        await historyStore.append(entries);
        dirty = true;
        scheduleRebuild();
        return [...entries];
      },
      prepareStep: async (messages: readonly ModelMessage[], context: PrepareStepContext) => {
        if (injectedTurn === context.turnId) return messages;
        injectedTurn = context.turnId;
        if (dirty) await rebuild(false);
        const eventKind = currentEvent;
        currentEvent = undefined;
        const bank = this.globalBanks.get(globalPath) ?? globalStore.read();
        globalPatterns = [
          ...selectGlobalPatterns(
            bank,
            eventKind ? "initiation" : "response",
            config.minGlobalChannels,
            config.maxGlobalPatterns,
          ),
        ];
        globalStylePatterns = [
          ...selectGlobalPatterns(bank, "response", config.minGlobalChannels, config.maxGlobalPatterns),
          ...selectGlobalPatterns(bank, "initiation", config.minGlobalChannels, config.maxGlobalPatterns),
        ];
        const currentText = latestUserText(messages);
        globalChains = currentText
          ? [
              ...selectRelevantGlobalChains(
                bank,
                currentText,
                config.minGlobalChannels,
                Math.min(config.maxGlobalPatterns, 3),
              ),
            ]
          : [...selectGlobalChains(bank, config.minGlobalChannels, config.maxGlobalPatterns)];
        const block = buildPromptBlock(state, eventKind, config, globalPatterns, globalChains, globalStylePatterns);
        logger.debug("chat_learning.prepare_step", {
          scope,
          turnId: context.turnId,
          step: context.stepNumber,
          dirty,
          eventKind,
          stateTurns: state?.turns.length ?? 0,
          stateLinks: state?.links.length ?? 0,
          blockLength: block?.length ?? 0,
        });
        const reflectionBlock = buildReflectionHistory(reflectionStore, config.maxInjectedReflections);
        const referenceParts: string[] = [];
        if (block) referenceParts.push(block);
        if (reflectionBlock) referenceParts.push(reflectionBlock);
        if (referenceParts.length === 0) return [...messages];
        const referenceMessage: ModelMessage = {
          role: "user",
          content: `[群聊风格参考，不要回复本段]\n\n${referenceParts.join("\n\n")}`,
        };
        return [...messages, referenceMessage];
      },
      stop: () => {
        this.rebuildHooks.delete(key);
        this.resetHooks.delete(key);
        this.syncHooks.delete(key);
        this.reflectHooks.delete(key);
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
      this.ctx.command("yesimbot.chat-learning.status", "查看 chat-learning 当前学习状态", { authority: 4 }).action(async ({ session }) => {
        try {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
          const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
          await stateStore.init();
          const state = stateStore.read();
          const feedback = await this.feedbackStoreFor(scope);
          const corrections = feedback.read();
          const global = await this.globalStoreFor(storagePath);
          const globalBank = global.store.read();
          const globalPatterns = globalBank.patterns.length;
          const globalChains = globalBank.chains.length;
          this.logger.debug("chat_learning.status", {
            scope,
            turns: state?.turns.length ?? 0,
            links: state?.links.length ?? 0,
            responsePatterns: state?.responsePatterns.length ?? 0,
            initiationPatterns: state?.initiationPatterns.length ?? 0,
            corrections: corrections.length,
            globalPatterns,
            globalChains,
          });
          const text = [
            `chat-learning ${scope.platform}:${scope.channelId}`,
            `turns=${state?.turns.length ?? 0}`,
            `links=${state?.links.length ?? 0}`,
            `responsePatterns=${state?.responsePatterns.length ?? 0}`,
            `initiationPatterns=${state?.initiationPatterns.length ?? 0}`,
            `corrections=${corrections.length}`,
            `globalPatterns=${globalPatterns}`,
            `globalChains=${globalChains}`,
            `state=${join(storagePath, "chat-learning.json")}`,
          ].join("\n");
          return await this.replyLong(session, text, text);
        } catch (cause) {
          this.logger.warn("chat_learning.status_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
          return `status 失败：${cause instanceof Error ? cause.message : String(cause)}`;
        }
      }),
    );

    track(
      this.ctx
        .command("yesimbot.chat-learning.global", "查看跨群全局学习规则", { authority: 4 })
        .option("limit", "<limit> 最多显示条数")
        .action(async ({ session, options }) => {
          try {
            const scope = scopeOf(session);
            if (!scope) return "无法获取当前频道信息";
            const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
            const { store, path } = await this.globalStoreFor(storagePath);
            const bank = this.globalBanks.get(path) ?? store.read();
            const limit = parsePositiveInt(options?.limit, 20);
            const responsePatterns = bank.patterns.filter((pattern) => pattern.kind === "response").slice(0, limit);
            const initiationPatterns = bank.patterns.filter((pattern) => pattern.kind === "initiation").slice(0, limit);
            const chainPatterns = bank.chains.slice(0, limit);
            const lines = [
              `global rules ${path}`,
              `patterns=${bank.patterns.length}`,
              `chains=${bank.chains.length}`,
              `response=${responsePatterns.length}`,
              `initiation=${initiationPatterns.length}`,
            ];
            if (responsePatterns.length > 0) {
              lines.push("", "response:");
              lines.push(...responsePatterns.map(formatGlobalPattern));
            }
            if (initiationPatterns.length > 0) {
              lines.push("", "initiation:");
              lines.push(...initiationPatterns.map(formatGlobalPattern));
            }
            if (chainPatterns.length > 0) {
              lines.push("", "chains:");
              lines.push(...chainPatterns.map(formatGlobalChain));
            }
            const text = lines.join("\n");
            this.logger.debug("chat_learning.global_preview", { scope, path, patterns: bank.patterns.length, chains: bank.chains.length, limit });
            return await this.replyLong(session, text, text);
          } catch (cause) {
            this.logger.warn("chat_learning.global_preview_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
            return `global 失败：${cause instanceof Error ? cause.message : String(cause)}`;
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
            const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
            const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
            await stateStore.init();
            const state = stateStore.read();
            const { store: globalStore, path: globalPath } = await this.globalStoreFor(storagePath);
            const bank = this.globalBanks.get(globalPath) ?? globalStore.read();
            const globalPatterns = selectGlobalPatterns(
              bank,
              eventKind ? "initiation" : "response",
              this.config.minGlobalChannels,
              this.config.maxGlobalPatterns,
            );
            const globalStylePatterns = [
              ...selectGlobalPatterns(bank, "response", this.config.minGlobalChannels, this.config.maxGlobalPatterns),
              ...selectGlobalPatterns(bank, "initiation", this.config.minGlobalChannels, this.config.maxGlobalPatterns),
            ];
            const globalChains = selectGlobalChains(
              bank,
              this.config.minGlobalChannels,
              this.config.maxGlobalPatterns,
            );
            const block = buildPromptBlock(
              state,
              eventKind,
              this.config,
              globalPatterns,
              globalChains,
              globalStylePatterns,
            );
            const reflection = await this.reflectionForPreview(scope, block);
            if (!block) return "当前没有可注入的学习上下文";
            this.logger.debug("chat_learning.preview", {
              scope,
              eventKind,
              globalPatterns: globalPatterns.length,
              globalChains: globalChains.length,
              globalBankPatterns: bank.patterns.length,
              globalBankChains: bank.chains.length,
              reflection: reflection !== undefined,
              tokens: estimateTokens(block),
              blockLength: block.length,
            });
            const prefix =
              `token≈${estimateTokens(block)} ` +
              `globalPatterns=${globalPatterns.length}/${bank.patterns.length} ` +
              `globalChains=${globalChains.length}/${bank.chains.length}`;
            const reflectionBlock = reflection ? `\n\n<reflection>\n${reflection}\n</reflection>` : "";
            const fallbackReflection = reflection ? `\n\n&lt;reflection&gt;\n${escapePromptText(reflection)}\n&lt;/reflection&gt;` : "";
            const rawText = `${prefix}\n\n${block}${reflectionBlock}`;
            const fallbackText = `${prefix}\n\n${escapePromptText(block)}${fallbackReflection}`;
            return await this.replyLong(session, rawText, fallbackText);
          } catch (cause) {
            this.logger.warn("chat_learning.preview_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
            return `preview 失败：${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }),
    );

    track(
      this.ctx.command("yesimbot.chat-learning.sync", "立即触发学习总结与跨群同步", { authority: 4 }).action(async ({ session }) => {
        try {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          const key = scopeKey(scope);
          const hook = this.syncHooks.get(key);
          if (hook) {
            await hook();
          } else {
            await this.syncGlobalHistoryOnly();
          }
          const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
          const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
          await stateStore.init();
          const state = stateStore.read();
          const global = await this.globalStoreFor(storagePath);
          const globalBank = global.store.read();
          const globalPatterns = globalBank.patterns.length;
          const globalChains = globalBank.chains.length;
          this.logger.debug("chat_learning.sync_done", {
            scope,
            turns: state?.turns.length ?? 0,
            links: state?.links.length ?? 0,
            responsePatterns: state?.responsePatterns.length ?? 0,
            initiationPatterns: state?.initiationPatterns.length ?? 0,
            globalPatterns,
            globalChains,
          });
          return [
            "已触发学习总结",
            `turns=${state?.turns.length ?? 0}`,
            `links=${state?.links.length ?? 0}`,
            `responsePatterns=${state?.responsePatterns.length ?? 0}`,
            `initiationPatterns=${state?.initiationPatterns.length ?? 0}`,
            `globalPatterns=${globalPatterns}`,
            `globalChains=${globalChains}`,
          ].join("\n");
        } catch (cause) {
          this.logger.warn("chat_learning.sync_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
          return `sync 失败：${cause instanceof Error ? cause.message : String(cause)}`;
        }
      }),
    );

    track(
      this.ctx.command("yesimbot.chat-learning.reset", "清空 chat-learning 学习数据", { authority: 4 }).action(async ({ session }) => {
        try {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
          const history = await this.historyStoreFor(scope);
          await history.clear();
          const feedback = await this.feedbackStoreFor(scope);
          await feedback.clear();
          const reflections = await this.reflectionStoreFor(scope);
          await reflections.clear();
          const stateStore = createChatLearningStore(join(storagePath, "chat-learning.json"));
          await stateStore.init();
          await stateStore.clear();
          this.resetHooks.get(scopeKey(scope))?.();
          this.logger.debug("chat_learning.reset", { scope });
          return "已清空 chat-learning 学习数据，不影响会话历史。";
        } catch (cause) {
          this.logger.warn("chat_learning.reset_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
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
      this.ctx.command("yesimbot.chat-learning.unlink <from> <to> [kind]", "手动移除消息关系", { authority: 4 }).action(async ({ session }, from, to, kind) => {
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

    track(
      this.ctx
        .command("yesimbot.chat-learning.reflect [note]", "人工标注 bot 的最终发言反思", { authority: 4 })
        .option("score", "<score> -1|0|1")
        .action(async ({ session, options }, note) => {
          const scope = scopeOf(session);
          if (!scope) return "无法获取当前频道信息";
          const text = quoteText(session?.quote);
          if (text.length === 0) return "请引用 bot 的一条最终发言后再运行";
          const parsedScore = parseReflectionScore(options?.score);
          if (parsedScore === undefined) return "score 必须是 -1|0|1";
          const store = await this.reflectionStoreFor(scope);
          const record = await store.append({
            source: "human",
            text,
            reflection: note?.trim() || humanReflectionText(parsedScore),
            score: parsedScore,
            annotation: note?.trim(),
            messageId: session?.quote?.id ?? session?.quote?.messageId,
            turnId: undefined,
          });
          this.logger.debug("chat_learning.reflection_annotated", { scope, id: record.id, score: record.score });
          return `已保存人工反思 ${record.id}`;
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

  private async feedbackStoreFor(scope: FullScope): Promise<FeedbackStore> {
    const key = scopeKey(scope);
    const existing = this.feedbackStores.get(key);
    if (existing) return existing;
    const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
    const store = createFeedbackStore(join(storagePath, "chat-learning-feedback.jsonl"));
    await store.init();
    this.feedbackStores.set(key, store);
    return store;
  }

  private async historyStoreFor(scope: FullScope): Promise<ChatHistoryStore> {
    const key = scopeKey(scope);
    const existing = this.historyStores.get(key);
    if (existing) return existing;
    const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
    const store = createChatHistoryStore(join(storagePath, "chat-learning-history.jsonl"));
    await store.init();
    this.historyStores.set(key, store);
    return store;
  }

  private async reflectionStoreFor(scope: FullScope): Promise<ReflectionStore> {
    const key = scopeKey(scope);
    const existing = this.reflectionStores.get(key);
    if (existing) return existing;
    const storagePath = (await this.ctx.yesimbot.resource.get(scope)).path;
    const store = createReflectionStore(join(storagePath, "chat-learning-reflections.jsonl"));
    await store.init();
    this.reflectionStores.set(key, store);
    return store;
  }

  private async reflectionForPreview(scope: FullScope, _styleBlock: string | undefined): Promise<string | undefined> {
    const store = await this.reflectionStoreFor(scope);
    return buildReflectionHistory(store, this.config.maxInjectedReflections);
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
    return configured ? resolve(this.ctx.baseDir, configured) : join(this.ctx.baseDir, "data/yesimbot", "chat-learning-global.json");
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
      user: { id: session.userId ?? session.author?.id ?? "", ...(userName === undefined ? {} : { name: userName }) },
      messageId: session.messageId,
      elements: session.elements,
    });
    const entry = createMessageEntry(record, { id: `global-${session.messageId}-${session.timestamp}`, timestamp: session.timestamp });
    await store.append([entry]);
    this.logger.debug("chat_learning.observe_global", { scope: scopeOf(session), messageId: session.messageId });
  }

  private async syncGlobalHistoryOnly(): Promise<void> {
    const { store, path } = await this.globalStoreFor("");
    await this.syncGlobalFromHistory(path, store, this.config);
  }

  private async syncGlobalFromHistory(globalPath: string, globalStore: GlobalRuleStore, config: ChatLearningConfig): Promise<void> {
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
      const links = buildLinks(turns);
      const modelId = resolveChatLearningModelId(this.ctx, config);
      const patterns = modelId
        ? await classifyPatternsWithModel(this.ctx.yesimbot.model.resolveChatModel(modelId).model, turns, segments, links, {
            maxThreads: config.maxModelThreads,
            maxThreadMessages: config.maxModelThreadMessages,
          }).catch((cause) => {
            this.logger.warn("chat_learning.global_classify_failed", { model: modelId, cause: cause instanceof Error ? cause.message : String(cause) });
            return undefined;
          })
        : undefined;
      const responsePatterns = patterns?.responsePatterns ?? [];
      const initiationPatterns = patterns?.initiationPatterns ?? [];
      const chainPatterns = buildLocalChainPatterns(segments, links, responsePatterns, initiationPatterns);
      const localEmbeddings = await buildPatternEmbeddingMap(this.ctx, config, responsePatterns, initiationPatterns);
      bank = mergeLocalPatterns(bank, responsePatterns, initiationPatterns, chainPatterns, scopeKeyValue, Date.now(), {
        localEmbeddings,
        embeddingSimilarity: config.embeddingSimilarity,
      });
    }

    await globalStore.update(bank);
    this.globalBanks.set(globalPath, bank);
    await history.clear();
    this.logger.debug("chat_learning.global_history_sync", {
      globalPath,
      groups: groups.size,
      entries: entries.length,
      globalPatterns: bank.patterns.length,
      globalChains: bank.chains.length,
    });
  }

  private async replyLong(session: Session | undefined, forwardText: string, fallbackText: string): Promise<string | undefined> {
    if (!session || forwardText.length <= 200) return fallbackText;
    try {
      if (await sendChatLearningForward(session, forwardText)) {
        this.logger.debug("chat_learning.forward_sent", { scope: scopeOf(session), chars: forwardText.length });
        return undefined;
      }
    } catch (cause) {
      this.logger.warn("chat_learning.forward_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
    }
    return fallbackText;
  }
}

function buildSnapshot(
  entries: readonly AgentEntry[],
  config: ChatLearningConfig,
  scope: FullScope,
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
  const lastEntry = [...entries].reverse().find((entry) => entry.type === "message");
  return { lastEntryId: lastEntry?.id, builtAt: now, turns, links, segments, responsePatterns: [], initiationPatterns: [] };
}

async function enrichWithModel(state: ChatLearningState, config: ChatLearningConfig, ctx: Context, logger: Logger): Promise<ChatLearningState> {
  const modelId = resolveChatLearningModelId(ctx, config);
  if (!modelId) return state;
  try {
    const ref = ctx.yesimbot.model.resolveChatModel(modelId);
    const patterns = await classifyPatternsWithModel(ref.model, state.turns, state.segments, state.links, {
      maxThreads: config.maxModelThreads,
      maxThreadMessages: config.maxModelThreadMessages,
    });
    if (!patterns) return state;
    return { ...state, responsePatterns: patterns.responsePatterns, initiationPatterns: patterns.initiationPatterns, builtAt: Date.now() };
  } catch (cause) {
    logger.warn("chat_learning.model_enrich_failed", { model: modelId, cause: cause instanceof Error ? cause.message : String(cause) });
    return state;
  }
}

function resolveChatLearningModelId(ctx: Context, config: ChatLearningConfig): string | undefined {
  const configured = config.summaryModel?.trim();
  if (configured) return configured;
  return ctx.yesimbot.model.getDefaultChatModelId();
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

function formatGlobalPattern(pattern: GlobalPattern): string {
  const total = pattern.channels.reduce((sum, channel) => sum + channel.frequency, 0);
  return `- [${pattern.intent}] "${pattern.phrase}" channels=${pattern.channels.length} total=${total}`;
}

function formatGlobalChain(chain: GlobalChainPattern): string {
  const total = chain.channels.reduce((sum, channel) => sum + channel.frequency, 0);
  return `- ${chain.chain.join(" -> ")} channels=${chain.channels.length} total=${total}`;
}

function latestUserText(messages: readonly ModelMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") {
      return content.replace(/^\[time=[^\]]*\]\s*/, "").trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (typeof part === "object" && part !== null && "text" in part) {
            return String((part as { text?: unknown }).text ?? "");
          }
          return "";
        })
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

function buildReflectionHistory(store: ReflectionStore, limit: number): string | undefined {
  const all = store.read();
  const human = all.filter((record) => record.source === "human").slice(-limit);
  const auto = all.filter((record) => record.source === "auto").slice(-(limit - human.length));
  const records: readonly ReflectionRecord[] = [...human, ...auto];
  if (records.length === 0) return undefined;
  const lines = records.map((record) => {
    const score = record.score === undefined ? "" : ` score="${record.score}"`;
    const target = formatReflectionTarget(record.text);
    const targetLine = target ? `<target>${escapePromptText(target)}</target>` : "";
    return `<reflection source="${record.source}"${score}>${targetLine}${escapePromptText(record.reflection)}</reflection>`;
  });
  return `<reflection_history>\n${lines.join("\n")}\n</reflection_history>`;
}

function quoteText(quote: Session["quote"] | undefined): string {
  if (!quote) return "";
  if (Array.isArray(quote.elements)) return quote.elements.map(String).join("");
  return quote.content ?? "";
}

function parseReflectionScore(value: unknown): ReflectionScore | undefined {
  if (typeof value === "number") return value === -1 || value === 0 || value === 1 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "good", "好", "像"].includes(normalized)) return 1;
  if (["-1", "bad", "差", "不像"].includes(normalized)) return -1;
  if (["0", "normal", "一般", "中"].includes(normalized)) return 0;
  return undefined;
}

function humanReflectionText(score: ReflectionScore): string {
  if (score === 1) return "这条最终发言更像群友，保持这种风格。";
  if (score === -1) return "这条最终发言不够像群友，需要更贴近群内语气和长度。";
  return "这条最终发言风格一般，可以在语气或长度上再调整。";
}

function scopeOf(session: Session | undefined): FullScope | null {
  if (!session?.platform || !session.selfId || !session.channelId) return null;
  return { type: session.isDirect ? "direct" : "shared", platform: session.platform, selfId: session.selfId, channelId: session.channelId };
}

function scopeKey(scope: FullScope): string {
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
