import {
  createAgent,
  type Agent,
  type AgentEntry,
  type AgentMessage,
  type AgentPlugin,
  type AgentStorage,
} from "@yesimbot/agent-runtime";
import { Context, Service, Session } from "koishi";

import { ensureChannelScopeRecord, type ChannelScope, type ChannelScopeId } from "./channel.js";
import type { Config } from "./config.js";
import { ModelService } from "./model/service.js";
import {
  createChannelRuntimeKey,
  createChannelSessionPath,
  resolveBasePath,
} from "./runtime/key.js";
import {
  createPlatformMessage,
  createMessageRoute,
  getChannelScope,
  getChannelType,
  platformMessagePlugin,
} from "./runtime/message.js";
import { buildCoreSystemPrompt, createPromptPlugins } from "./runtime/prompt.js";
import { extractAssistantTexts } from "./runtime/render.js";
import { createJsonlStorage } from "./runtime/storage.js";
import type { ChannelAgentContext } from "./shared/types.js";

export type AgentPluginFactory = (context: ChannelAgentContext) => AgentPlugin;

interface CachedRuntime {
  key: ChannelScopeId;
  scope: ChannelScope;
  runtime: Agent;
  storage: AgentStorage<AgentEntry>;
}

const GENERIC_ERROR_REPLY = "YesImBot encountered an error. Check the logs.";

declare module "koishi" {
  interface Context {
    yesimbot: YesImBotService;
  }
}

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model"];

  public readonly model: ModelService;

  private readonly agentPluginFactories: AgentPluginFactory[] = [];
  private readonly runtimes = new Map<ChannelScopeId, CachedRuntime>();
  private readonly activeTurns = new Map<ChannelScopeId, string>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;

    this.model = ctx["yesimbot.model"];

    ctx.command("yesimbot.reset", { authority: 4 }).action(async ({ session }) => {
      if (!session?.platform || !session.selfId || !session.channelId) {
        return;
      }

      await this.resetChannel({
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId,
      });
    });
    ctx.middleware(async (session, next) => {
      await this.handleSession(session);
      return next();
    });
  }

  registerAgentPlugin(factory: AgentPluginFactory): () => void {
    this.agentPluginFactories.push(factory);

    return () => {
      const index = this.agentPluginFactories.indexOf(factory);
      if (index >= 0) {
        this.agentPluginFactories.splice(index, 1);
      }
    };
  }

  async resetChannel(scope: ChannelScope): Promise<void> {
    const key = createChannelRuntimeKey(scope);
    const cached = this.runtimes.get(key);
    const storage = cached?.storage ?? (await this.createStorage(scope));

    this.activeTurns.delete(key);

    if (cached) {
      await cached.runtime.interrupt("reset");
      await cached.runtime.stop();
    }

    await storage.clear();
    this.runtimes.delete(key);
  }

  override async stop(): Promise<void> {
    const cached = [...this.runtimes.values()];

    this.runtimes.clear();
    this.activeTurns.clear();

    for (const entry of cached) {
      await entry.runtime.interrupt("dispose");
      await entry.runtime.stop();
    }
  }

  protected getAgentPluginFactories(): readonly AgentPluginFactory[] {
    return [...this.agentPluginFactories];
  }

  protected createExternalAgentPlugins(context: ChannelAgentContext): AgentPlugin[] {
    return this.getAgentPluginFactories().map((factory) => factory(context));
  }

  protected createRuntimePlugins(context: ChannelAgentContext): AgentPlugin[] {
    const basePath = resolveBasePath(this.config.basePath, this.ctx.baseDir);
    return [
      platformMessagePlugin,
      ...createPromptPlugins({ basePath, logger: this.logger }),
      ...this.createExternalAgentPlugins(context),
    ];
  }

  private createChannelContext(session: Session): ChannelAgentContext {
    return {
      channel: {
        ...getChannelScope(session),
        type: getChannelType(session),
      },
      platform: {
        name: session.platform,
        unsafeBot: session.bot,
      },
    };
  }

  private async createStorage(scope: ChannelScope): Promise<AgentStorage<AgentEntry>> {
    const basePath = resolveBasePath(this.config.basePath, this.ctx.baseDir);
    await ensureChannelScopeRecord(basePath, scope);
    return createJsonlStorage(createChannelSessionPath(basePath, scope));
  }

  private async getChannelAgent(session: Session): Promise<CachedRuntime> {
    const scope = getChannelScope(session);
    const key = createChannelRuntimeKey(scope);
    const cached = this.runtimes.get(key);
    if (cached) {
      return cached;
    }

    const context = this.createChannelContext(session);
    const model = this.ctx["yesimbot.model"].resolveChatModel(this.config.chatModel).model;
    const storage = await this.createStorage(scope);
    const runtime = createAgent({
      id: key,
      model,
      storage,
      systemPrompt: buildCoreSystemPrompt(context),
      plugins: this.createRuntimePlugins(context),
      terminalTool: true,
    });
    const next: CachedRuntime = {
      key,
      scope,
      runtime,
      storage,
    };
    this.runtimes.set(key, next);
    return next;
  }

  async handleSession(session: Session): Promise<void> {
    const scope = getChannelScope(session);
    const key = createChannelRuntimeKey(scope);
    const route = createMessageRoute(session, { isBusy: this.activeTurns.has(key) });

    if (route.action === "ignore") {
      return;
    }

    try {
      const { runtime } = await this.getChannelAgent(session);
      const message = createPlatformMessage(session);

      if (route.action === "append") {
        await runtime.append(message);
        return;
      }

      if (route.action === "join") {
        runtime.send(message, { ifBusy: "join" });
        return;
      }

      this.activeTurns.set(key, "active");
      try {
        const stream = runtime.run(message);
        const assistantMessages: AgentMessage[] = [];

        for await (const event of stream) {
          if (event.type === "message.appended" && event.message.role === "assistant") {
            assistantMessages.push(event.message);
          }
          if (event.type === "turn.failed") {
            throw new Error(event.error?.message ?? "turn failed");
          }
          if (event.type === "turn.queued" || event.type === "turn.start") {
            this.activeTurns.set(key, event.turnId);
          }
        }

        for (const text of extractAssistantTexts(assistantMessages)) {
          await session.send?.(text);
        }
      } finally {
        this.activeTurns.delete(key);
      }
    } catch (error) {
      this.logger.error({
        event: "session.processing_failed",
        key,
        action: route.action,
        cause: error instanceof Error ? error.message : String(error),
      });

      if (route.action !== "append") {
        await session.send?.(GENERIC_ERROR_REPLY);
      }
    }
  }
}
