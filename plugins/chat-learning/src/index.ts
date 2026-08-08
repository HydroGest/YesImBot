import { join } from "node:path";

import type {
  AgentEntry,
  AgentPlugin,
  AgentPluginRuntime,
  AgentStorage,
  PrepareStepContext,
} from "@yesimbot/agent-runtime";
import type { ModelMessage } from "ai";
import { Context, Logger, Schema } from "koishi";
import { isEvent, type ChannelScope } from "koishi-plugin-yesimbot";

import { collectTurns, segmentTurns } from "./collector.js";
import { buildLinks } from "./links.js";
import { enrichPatternsWithModel, extractPatterns } from "./patterns.js";
import { buildPromptBlock } from "./projector.js";
import { createChatLearningStore } from "./store.js";
import type { ChatLearningConfig, ChatLearningState, ProactiveEventKind } from "./types.js";

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

  public constructor(ctx: Context, config: ChatLearningConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.chat-learning");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope }) => this.createAgentPlugin(scope));
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }

  private async createAgentPlugin(scope: ChannelScope): Promise<AgentPlugin> {
    const storagePath = await this.ctx.yesimbot.getStoragePath(scope);
    const store = createChatLearningStore(join(storagePath, "chat-learning.json"));
    await store.init();
    const config = this.config;
    const logger = this.logger;

    let runtimeStorage: AgentStorage<AgentEntry> | undefined;
    let state = store.read();
    let dirty = true;
    let building: Promise<void> | undefined;
    let injectedTurn: string | undefined;
    let currentEvent: ProactiveEventKind | undefined;
    let lastModelEnrichAt = state?.builtAt ?? 0;

    const rebuild = async (allowModel: boolean): Promise<void> => {
      if (building) return building;
      const task = (async () => {
        if (!runtimeStorage) return;
        const entries = await runtimeStorage.read();
        const next = buildSnapshot(entries, config, scope);
        const refreshMs = config.refreshIntervalMinutes * 60 * 1000;
        const shouldEnrich =
          allowModel && config.summaryModel !== undefined && Date.now() - lastModelEnrichAt >= refreshMs;
        state = next;
        dirty = false;
        await store.update(next);
        if (!shouldEnrich) return;
        const enriched = await enrichWithModel(next, config, this.ctx, logger);
        if (shouldEnrich) lastModelEnrichAt = Date.now();
        state = enriched;
        await store.update(enriched);
      })().finally(() => {
        building = undefined;
      });
      building = task;
      return task;
    };

    return {
      name: "chat-learning",
      async init(runtime: AgentPluginRuntime) {
        runtimeStorage = runtime.storage;
        await rebuild(false);
        if (config.summaryModel !== undefined) void rebuild(true);
      },
      onAppend(entries: readonly AgentEntry[]) {
        dirty = true;
        void rebuild(false).catch((cause) => {
          logger.warn("chat_learning.rebuild_failed", {
            scope,
            cause: cause instanceof Error ? cause.message : String(cause),
          });
        });
        return [...entries];
      },
      toModelMessages(message) {
        if (isEvent(message)) currentEvent = proactiveEventKind(message.data.eventType);
        return undefined;
      },
      async prepareStep(messages: readonly ModelMessage[], context: PrepareStepContext) {
        if (injectedTurn === context.turnId) return messages;
        injectedTurn = context.turnId;
        if (dirty) await rebuild(false);
        const block = buildPromptBlock(state, currentEvent, config);
        return block ? [{ role: "system", content: block }, ...messages] : messages;
      },
    } satisfies AgentPlugin;
  }
}

function buildSnapshot(
  entries: readonly AgentEntry[],
  config: ChatLearningConfig,
  scope: ChannelScope,
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
  const links = buildLinks(turns, { selfId: scope.selfId });
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
    const patterns = await enrichPatternsWithModel(ref.model, state.turns, {
      responsePatterns: state.responsePatterns,
      initiationPatterns: state.initiationPatterns,
    });
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
