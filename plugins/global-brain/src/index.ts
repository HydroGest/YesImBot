import { join, resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot } from "koishi";
import type { ChannelResources, ChannelScope } from "koishi-plugin-yesimbot";

import { formatBrainDigest } from "./digest.js";
import { formatBrainPrompt } from "./prompt.js";
import { createGlobalBrainStore, type GlobalBrainStore } from "./store.js";
import { createBrainTools } from "./tools.js";
import { buildImmediateShareEvent, type BrainThread, type GlobalBrainConfig, scopeKey } from "./types.js";

interface ActiveScope {
  readonly scope: ChannelScope;
  readonly selfId: string;
}

export default class GlobalBrainPlugin {
  public static readonly name = "yesimbot-global-brain";
  public static readonly description =
    " 全局脑插件：让同一个 Bot 在多个群聊和私聊之间共享值得保留的知识、问题与经验。某个会话写入的内容会持久化到全局脑，其他会话按需读取，并自行判断是否回复、转发或吸收。";
  public static readonly inject = ["yesimbot"];
  public static readonly Config: Schema<GlobalBrainConfig> = Schema.object({
    shareImmediately: Schema.boolean().default(false).description("允许 brain_deposit 在请求时立即向其他 session 唤起一次请求"),
    storageDir: Schema.string().default("").description("全局脑存储目录；留空时使用 <baseDir>/global-brain"),
    brainPrompt: Schema.string().role("textarea").default("").description("全局脑对 agent 的提示词；留空使用内置默认提示词"),
    maxDigestThreads: Schema.number().min(1).max(20).default(5).description("每次自然 turn 最多摘要的全局脑新内容数量"),
    maxDigestReplies: Schema.number().min(1).max(20).default(5).description("每次自然 turn 最多摘要的回复线程数量"),
    maxDigestContentLength: Schema.number().min(1).max(2000).default(80).description("全局脑摘要中每条内容的最大字符数"),
    maxBlobBytes: Schema.number()
      .min(1)
      .default(5 * 1024 * 1024)
      .description("asset/artifact 物化到全局脑 blob 的最大字节数"),
  });

  public readonly ctx: Context;
  public readonly config: GlobalBrainConfig;
  public readonly logger: Logger;

  private readonly scopes = new Map<string, ActiveScope>();
  private store: GlobalBrainStore | undefined;
  private dispose: (() => unknown) | undefined;

  public constructor(ctx: Context, config: GlobalBrainConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.global-brain");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.dispose?.();
    this.dispose = undefined;
    const storageDir = this.config.storageDir ? resolve(this.ctx.baseDir, this.config.storageDir) : join(this.ctx.baseDir, "global-brain");
    const store = createGlobalBrainStore({
      filePath: join(storageDir, "brain.jsonl"),
      maxDigestThreads: this.config.maxDigestThreads,
      maxDigestReplies: this.config.maxDigestReplies,
      maxBlobBytes: this.config.maxBlobBytes,
      logger: this.logger,
    });
    await store.init();
    this.store = store;
    this.dispose = this.ctx.yesimbot.agent.use(this);
  }

  public async stop(): Promise<void> {
    this.dispose?.();
    this.dispose = undefined;
    this.scopes.clear();
    this.store = undefined;
  }

  public async setup(scope: ChannelScope, bot: Bot): Promise<AgentPlugin | null> {
    this.scopes.set(scopeKey(scope), { scope, selfId: bot.selfId });
    const resources = await this.ctx.yesimbot.resource.get(scope);
    return this.createAgentPlugin(scope, resources);
  }

  private createAgentPlugin(scope: ChannelScope, resources: ChannelResources): AgentPlugin | null {
    const store = this.store;
    if (!store) return null;
    const { assets, artifacts } = resources;
    let injectedTurn: string | undefined;
    return {
      name: "global-brain",
      tools: createBrainTools({
        store,
        scope,
        assets,
        artifacts,
        defaultShareImmediately: this.config.shareImmediately,
        onImmediateShare: (thread) => this.enqueueImmediateShare(thread, scope),
      }),
      appendSystemPrompt: () => (this.config.brainPrompt && this.config.brainPrompt.trim().length > 0 ? this.config.brainPrompt : formatBrainPrompt()),
      prepareStep: async (messages, context) => {
        if (injectedTurn === context.turnId) return messages;
        injectedTurn = context.turnId;
        const digest = await store.digest(scope);
        const text = formatBrainDigest(digest, this.config.maxDigestContentLength);
        return text ? [{ role: "system", content: text }, ...messages] : messages;
      },
    } satisfies AgentPlugin;
  }

  private enqueueImmediateShare(thread: BrainThread, sourceScope: ChannelScope): void {
    const sourceKey = scopeKey(sourceScope);
    for (const target of this.scopes.values()) {
      if (scopeKey(target.scope) === sourceKey) continue;
      void this.runImmediateShare(thread, target);
    }
  }

  private async runImmediateShare(thread: BrainThread, target: ActiveScope): Promise<void> {
    try {
      await this.ctx.yesimbot.messenger.post(buildImmediateShareEvent(target.scope, target.selfId, thread));
    } catch (cause) {
      this.logger.warn("global_brain.immediate_trigger_failed", {
        threadId: thread.id,
        targetScope: target.scope,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

export type { GlobalBrainStore } from "./store.js";
export { BrainStoreError, createGlobalBrainStore } from "./store.js";
export { formatBrainDigest } from "./digest.js";
export { formatBrainPrompt } from "./prompt.js";
export { createBrainTools } from "./tools.js";
export { buildImmediateShareEvent } from "./types.js";
export type {
  BrainDigest,
  BrainImmediateShare,
  BrainPostKind,
  BrainReply,
  BrainReplySource,
  BrainStatus,
  BrainThread,
  BrainThreadStatus,
  BrainThreadView,
  GlobalBrainConfig,
} from "./types.js";
