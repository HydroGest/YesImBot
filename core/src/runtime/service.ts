import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createAgent,
  type Agent,
  type AgentEntry,
  type AgentMessage,
  type AgentPlugin,
  type AgentStorage,
} from "@yesimbot/agent-runtime";
import { Context, Logger, Service, Session } from "koishi";

import { ensureChannelScopeRecord, type ChannelScope, type ChannelScopeId } from "../channel.js";
import type { Config } from "../config.js";
import { ModelService } from "../model/service.js";
import { elementsToLiteral } from "../platform/message.js";
import type { PlatformService } from "../platform/service.js";
import type { ChannelAgentContext } from "../shared/types.js";
import { createChannelRuntimeKey, createChannelSessionPath, resolveBasePath } from "./key.js";
import {
  classifyMessage,
  createPlatformMessage,
  getChannelScope,
  getChannelType,
} from "./message.js";
import { extractAssistantTexts } from "./render.js";
import { createJsonlStorage } from "./storage.js";

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

// ── prompt helpers (was runtime/prompt.ts) ──────────────────────

async function readPromptFile(
  basePath: string,
  fileName: "AGENTS.md" | "PERSONA.md",
  logger?: Logger,
): Promise<string | undefined> {
  try {
    const content = await readFile(join(basePath, fileName), "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger?.debug?.(`Prompt file ${fileName} not found under ${basePath}.`);
      return undefined;
    }
    logger?.warn?.(
      `Unable to read prompt file ${fileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

function createPromptFilePlugin(options: { basePath: string; logger?: Logger }): AgentPlugin {
  return {
    name: "core.prompt-files",
    async appendSystemPrompt() {
      const agents = await readPromptFile(options.basePath, "AGENTS.md", options.logger);
      const persona = await readPromptFile(options.basePath, "PERSONA.md", options.logger);
      const blocks = [
        agents ? { role: "system" as const, content: `<agents>\n${agents}\n</agents>` } : undefined,
        persona
          ? { role: "system" as const, content: `<persona>\n${persona}\n</persona>` }
          : undefined,
      ].filter((block): block is { role: "system"; content: string } => block !== undefined);
      return blocks.length > 0 ? blocks : undefined;
    },
  };
}

function buildCoreSystemPrompt(context: ChannelAgentContext): string {
  const { channel } = context;
  return [
    "You are Athena, a Koishi-based chat agent running in a channel.",
    `Channel context: platform=${channel.platform}, selfId=${channel.selfId}, channelId=${channel.channelId}, type=${channel.type}.`,
    "Channel messages are presented as [sender]: content and may include Koishi message element strings.",
    "Reply in plain text unless the user explicitly asks for another format.",
  ].join("\n");
}

// ── YesImBotService ─────────────────────────────────────────────

export class YesImBotService extends Service<Config> {
  static readonly inject = ["yesimbot.model", "yesimbot.platform"];

  public readonly model: ModelService;
  public readonly platform: PlatformService;

  private readonly agentPluginFactories: AgentPluginFactory[] = [];
  private readonly runtimes = new Map<ChannelScopeId, CachedRuntime>();
  private readonly cleanup: Array<() => unknown> = [];
  private readonly lifecycleTails = new Map<string, Promise<unknown>>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;

    this.model = ctx["yesimbot.model"];
    this.platform = ctx["yesimbot.platform"];

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

    const disposeMiddleware = ctx.middleware(
      (session, next) => this.handleSession(session, next),
      true,
    );
    if (typeof disposeMiddleware === "function") this.cleanup.push(disposeMiddleware);
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
    await this.enqueueChannel(key, async () => {
      const cached = this.runtimes.get(key);
      const storage = cached?.storage ?? (await this.createStorage(scope));

      if (cached) {
        await cached.runtime.interrupt("reset");
        await cached.runtime.stop();
      }

      await storage.clear();
      await this.platform.clearChannel(scope);
      this.runtimes.delete(key);
    });
  }

  override async stop(): Promise<void> {
    for (const dispose of this.cleanup.splice(0)) {
      try {
        dispose();
      } catch {
        // Koishi lifecycle disposers are best-effort during service shutdown.
      }
    }

    const cached = [...this.runtimes.values()];
    this.runtimes.clear();

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
    const external = this.createExternalAgentPlugins(context);
    const includeMessageId = external.some((p) => p.requiresMessageId === true);

    return [
      this.platform.createMessagePlugin({
        scope: context.channel,
        includeMessageId,
        diagnostic: (d) => this.logger.warn(d),
      }),
      createPromptFilePlugin({ basePath, logger: this.logger }),
      ...external,
    ];
  }

  // ── agent management ──────────────────────────────────────────

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
    if (cached) return cached;

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
    const next: CachedRuntime = { key, scope, runtime, storage };
    this.runtimes.set(key, next);
    return next;
  }

  async handleSession(session: Session, next?: () => Promise<unknown>): Promise<void> {
    const message = this.platform.getMessage(session) ?? this.platform.collectIfNeeded(session);
    if (!message) {
      await next?.();
      return;
    }

    const scope = getChannelScope(session);
    const key = createChannelRuntimeKey(scope);
    const routeSession = {
      ...session,
      content: session.content ?? elementsToLiteral(message.elements),
      userId: session.userId ?? message.sender.id,
      selfId: session.selfId || message.source.selfId,
    } as Session;
    // Run prepare + initial submission inside the FIFO queue;
    // stream consumption runs outside the lock.
    let stream: AsyncIterable<import("@yesimbot/agent-runtime").AgentInternalEvent> | undefined;
    let classification: import("./message.js").MessageClassification | undefined;
    let submittedAction: "append" | "send" | "run" | undefined;

    try {
      await this.enqueueChannel(key, async () => {
        classification = classifyMessage(routeSession);
        if (classification === "ignore") {
          return;
        }

        const prepared = await this.platform.prepareMessage(session, message);
        const { runtime } = await this.getChannelAgent(session);
        const runtimeMessage = createPlatformMessage(prepared);

        if (classification === "append") {
          submittedAction = "append";
          await runtime.append(runtimeMessage);
          return;
        }

        if (runtime.getActiveTurnId() != null) {
          submittedAction = "send";
          runtime.send(runtimeMessage, { ifBusy: "join" });
          return;
        }

        submittedAction = "run";
        stream = runtime.run(runtimeMessage);
      });
    } catch (error) {
      this.logger.error({
        event: "session.processing_failed",
        key,
        action: submittedAction ?? classification ?? "unknown",
        cause: error instanceof Error ? error.message : String(error),
      });

      if (classification === "reply") {
        await session.send?.(GENERIC_ERROR_REPLY);
      }
      await next?.();
      return;
    }

    if (stream) {
      try {
        const assistantMessages: AgentMessage[] = [];
        for await (const event of stream) {
          if (event.type === "message.appended" && event.message.role === "assistant") {
            assistantMessages.push(event.message);
          }
          if (event.type === "turn.failed") {
            throw new Error(event.error?.message ?? "turn failed");
          }
        }

        for (const text of extractAssistantTexts(assistantMessages)) {
          await session.send?.(text);
        }
      } catch (error) {
        this.logger.error({
          event: "session.processing_failed",
          key,
          action: submittedAction ?? classification ?? "run",
          cause: error instanceof Error ? error.message : String(error),
        });

        await session.send?.(GENERIC_ERROR_REPLY);
      }
    }

    await next?.();
  }

  // ── lifecycle queue ───────────────────────────────────────────

  private enqueueChannel<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prev = this.lifecycleTails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(operation);
    const tail = next.then(
      () => {},
      () => {},
    );
    this.lifecycleTails.set(key, tail);
    void tail.finally(() => {
      if (this.lifecycleTails.get(key) === tail) {
        this.lifecycleTails.delete(key);
      }
    });
    return next;
  }
}
