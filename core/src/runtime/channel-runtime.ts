import type {
  Agent,
  AgentEntry,
  AgentInternalEvent,
  AgentMessage,
  AgentPlugin,
  AgentStorage,
} from "@yesimbot/agent-runtime";
import { createAgent } from "@yesimbot/agent-runtime";
import { merge, type Context, type Logger, type Session } from "koishi";

import { ensureChannelScopeRecord, type ChannelScope, type ChannelScopeId } from "../channel.js";
import { type Config, type MessageRoutingConfig } from "../config.js";
import type { DeliveryService } from "../delivery/service.js";
import type { PlatformService } from "../platform/service.js";
import type { Platform } from "../platform/types.js";
import type { ChannelAgentContext } from "../shared/types.js";
import { createChannelRuntimeKey, createChannelSessionPath, resolveBasePath } from "./key.js";
import { classifyMessage, createPlatformMessage, getChannelScope } from "./message.js";
import { buildCoreSystemPrompt, createPromptFilePlugin } from "./prompt.js";
import { extractAssistantOutputs } from "./render.js";
import { createJsonlStorage } from "./storage.js";

interface CachedRuntime {
  key: ChannelScopeId;
  scope: ChannelScope;
  runtime: Agent;
  storage: AgentStorage<AgentEntry>;
}

export interface ChannelRuntimeOptions {
  ctx: Context;
  config: Config;
  logger: Logger;
  platform: PlatformService;
  delivery: DeliveryService;
  getAgentPlugins(context: ChannelAgentContext): readonly AgentPlugin[];
}

export class ChannelRuntime {
  private readonly runtimes = new Map<ChannelScopeId, CachedRuntime>();
  private readonly lifecycleTails = new Map<string, Promise<unknown>>();
  private readonly streamTasks = new Set<Promise<void>>();
  private readonly routing: MessageRoutingConfig;
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly options: ChannelRuntimeOptions) {
    this.routing = merge(options.config.routing ?? {}, {
      direct: "reply",
      group: "append",
      mention: "reply",
    }) as MessageRoutingConfig;
  }

  async handle(message: Platform.Message, session: Session): Promise<void> {
    this.assertOpen();
    const scope = getChannelScope(message);
    const key = createChannelRuntimeKey(scope);
    let stream: AsyncIterable<AgentInternalEvent> | undefined;
    let classification: "ignore" | "append" | "reply" | undefined;

    try {
      await this.enqueueChannel(key, async () => {
        classification = classifyMessage(message, this.routing);
        if (classification === "ignore") return;

        const prepared = await this.options.platform.prepareMessage(session, message);
        const { runtime } = await this.getChannelAgent(prepared, session);
        const runtimeMessage = createPlatformMessage(prepared);

        if (classification === "append") {
          await runtime.append(runtimeMessage);
          return;
        }

        if (runtime.getActiveTurnId() != null) {
          runtime.send(runtimeMessage, { ifBusy: "join" });
          return;
        }

        stream = runtime.run(runtimeMessage);
      });
    } catch (cause) {
      await this.reportProcessingFailure(
        session,
        key,
        classification ?? "unknown",
        cause,
        classification === "reply",
      );
      return;
    }

    if (stream) {
      const task = this.consumeStream(stream, session).catch((cause) =>
        this.reportProcessingFailure(session, key, "run", cause, true),
      );
      await this.trackStream(task);
    }
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const key = createChannelRuntimeKey(scope);
    await this.enqueueChannel(key, async () => {
      const cached = this.runtimes.get(key);
      const storage = cached?.storage ?? (await this.createStorage(scope));
      if (cached) {
        await cached.runtime.interrupt("reset");
        await cached.runtime.stop();
      }
      await storage.clear();
      await this.options.platform.clearChannel(scope);
      this.runtimes.delete(key);
    });
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
  }

  private async stopInternal(): Promise<void> {
    await Promise.allSettled([...this.lifecycleTails.values()]);
    const cached = [...this.runtimes.values()];
    for (const entry of cached) {
      await this.teardownRuntime(entry);
    }
    await Promise.allSettled([...this.streamTasks]);
    this.runtimes.clear();
  }

  private async teardownRuntime(entry: CachedRuntime): Promise<void> {
    try {
      await entry.runtime.interrupt("dispose");
    } catch (cause) {
      this.reportTeardownFailure(entry.key, "interrupt", cause);
    }
    try {
      await entry.runtime.stop();
    } catch (cause) {
      this.reportTeardownFailure(entry.key, "stop", cause);
    }
  }

  private reportTeardownFailure(key: ChannelScopeId, operation: string, cause: unknown): void {
    try {
      this.options.logger.error({
        event: "runtime.teardown_failed",
        key,
        operation,
        cause: errorMessage(cause),
      });
    } catch {
      // Shutdown diagnostics cannot interrupt best-effort teardown.
    }
  }

  private createChannelContext(message: Platform.Message, session: Session): ChannelAgentContext {
    return {
      channel: { ...getChannelScope(message), type: message.scope.channelType },
      platform: { name: message.source.platform, unsafeBot: session.bot },
    };
  }

  private async createStorage(scope: ChannelScope): Promise<AgentStorage<AgentEntry>> {
    const basePath = resolveBasePath(this.options.config.basePath, this.options.ctx.baseDir);
    await ensureChannelScopeRecord(basePath, scope);
    return createJsonlStorage(createChannelSessionPath(basePath, scope));
  }

  private async getChannelAgent(
    message: Platform.Message,
    session: Session,
  ): Promise<CachedRuntime> {
    const scope = getChannelScope(message);
    const key = createChannelRuntimeKey(scope);
    const cached = this.runtimes.get(key);
    if (cached) return cached;

    const context = this.createChannelContext(message, session);
    const model = this.options.ctx["yesimbot.model"].resolveChatModel(
      this.options.config.chatModel,
    ).model;
    const storage = await this.createStorage(scope);
    const external = this.options.getAgentPlugins(context);
    const includeMessageId = external.some((plugin) => plugin.requiresMessageId === true);
    const runtime = createAgent({
      id: key,
      model,
      storage,
      systemPrompt: buildCoreSystemPrompt(context),
      plugins: [
        this.options.platform.createMessagePlugin({
          scope,
          includeMessageId,
          diagnostic: (diagnostic) => this.options.logger.warn(diagnostic),
        }),
        createPromptFilePlugin({
          basePath: resolveBasePath(this.options.config.basePath, this.options.ctx.baseDir),
          logger: this.options.logger,
        }),
        ...external,
      ],
      terminalTool: true,
    });
    const next: CachedRuntime = { key, scope, runtime, storage };
    this.runtimes.set(key, next);
    return next;
  }

  private async consumeStream(
    stream: AsyncIterable<AgentInternalEvent>,
    session: Session,
  ): Promise<void> {
    const assistantMessages: AgentMessage[] = [];
    for await (const event of stream) {
      if (event.type === "message.appended" && event.message.role === "assistant") {
        assistantMessages.push(event.message);
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error?.message ?? "turn failed");
      }
    }
    const outputs = extractAssistantOutputs(assistantMessages);
    if (outputs.length > 0) {
      const receipt = await this.options.delivery.reply(session, outputs);
      if (receipt.status !== "sent") {
        this.options.logger.warn({ event: "delivery.reply_failed", receipt });
      }
    }
  }

  private trackStream(task: Promise<void>): Promise<void> {
    this.streamTasks.add(task);
    void task.then(
      () => this.streamTasks.delete(task),
      () => this.streamTasks.delete(task),
    );
    return task;
  }

  private async reportProcessingFailure(
    session: Session,
    key: string,
    action: string,
    cause: unknown,
    shouldReply: boolean,
  ): Promise<void> {
    this.options.logger.error({
      event: "session.processing_failed",
      key,
      action,
      cause: errorMessage(cause),
    });
    if (!shouldReply) return;
    try {
      const receipt = await this.options.delivery.reply(session, [GENERIC_ERROR_REPLY]);
      if (receipt.status !== "sent") {
        this.options.logger.warn({ event: "delivery.error_reply_failed", key, receipt });
      }
    } catch (deliveryCause) {
      this.options.logger.warn({
        event: "delivery.error_reply_failed",
        key,
        cause: errorMessage(deliveryCause),
      });
    }
  }

  private enqueueChannel<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleTails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.lifecycleTails.set(key, tail);
    void tail.finally(() => {
      if (this.lifecycleTails.get(key) === tail) this.lifecycleTails.delete(key);
    });
    return next;
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const GENERIC_ERROR_REPLY = "YesImBot encountered an error. Check the logs.";
