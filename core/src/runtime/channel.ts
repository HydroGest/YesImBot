import { isAbsolute, resolve } from "node:path";

import {
  createAgent,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentToolSet,
} from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";
import type { Bot, Context, Fragment, Logger } from "koishi";
import { z } from "zod";

import { channelKey, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import { formatEvent } from "../event/formatter.js";
import { createEvent, type Event, type EventRecord } from "../event/index.js";
import type { AssetStore } from "../shared/asset.js";
import type { Will, WillObservation } from "../will/index.js";
import { buildCoreSystemPrompt, createPromptFilePlugin } from "./prompt.js";
import { createChannelStorage } from "./storage.js";

export interface ChannelRuntimeOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly will: Will;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly model: LanguageModel;
  readonly agentPlugins: readonly AgentPlugin[];
  readonly includeMessageId: boolean;
}

export const MAX_RECENT_EVENTS = 32;

class OutputQueue<T> implements AsyncIterable<T> {
  #items: T[] = [];
  #waiter:
    | {
        resolve: (result: IteratorResult<T>) => void;
        reject: (cause: unknown) => void;
      }
    | undefined;
  #error: unknown;
  #done = false;

  push(item: T): void {
    if (this.#done) return;
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter) waiter.resolve({ done: false, value: item });
    else this.#items.push(item);
  }

  close(error?: unknown): void {
    if (this.#done) return;
    this.#done = true;
    this.#error = error;
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter) {
      if (error) waiter.reject(error);
      else waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = this.#items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.#error) throw this.#error;
        if (this.#done) return { done: true, value: undefined };
        return await new Promise<IteratorResult<T>>((resolve, reject) => {
          this.#waiter = { resolve, reject };
        });
      },
    };
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function resolveBasePath(basePath: string, ctx: Context): string {
  return isAbsolute(basePath) ? basePath : resolve(ctx.baseDir, basePath);
}

function isRenderableAssistant(event: AgentInternalEvent): event is AgentInternalEvent & {
  type: "message.appended";
  turnId: string;
  message: { id: string; role: "assistant"; content: unknown };
} {
  return (
    event.type === "message.appended" &&
    "turnId" in event &&
    event.message.role === "assistant" &&
    renderAssistantContent(event.message.content) !== undefined
  );
}

function renderAssistantContent(content: unknown): Fragment | undefined {
  if (typeof content === "string") return content.trim().length > 0 ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("");
  return text.trim().length > 0 ? text : undefined;
}

export class ChannelRuntime {
  readonly scope: ChannelScope;

  #tail = Promise.resolve();
  #stopped = false;
  #stopTask: Promise<void> | undefined;
  #streamTasks = new Set<Promise<void>>();
  #pending: Event[] = [];
  #recent: Event[] = [];
  #lastActivityAt: number | null = null;
  readonly #agent: Agent;

  constructor(private readonly options: ChannelRuntimeOptions) {
    this.scope = Object.freeze({ ...options.scope });
    const plugins = options.agentPlugins;
    const includeMessageId = options.includeMessageId;
    const storage = createChannelStorage(
      resolveBasePath(options.config.basePath, options.ctx),
      this.scope,
    );
    const tools: AgentToolSet = [
      {
        name: "sendMessage",
        description: "Send a message to an explicit channel using the current bot.",
        inputSchema: z.object({ channelId: z.string().min(1), content: z.string() }),
        execute: async ({ channelId, content }: { channelId: string; content: string }) => {
          try {
            const messageIds = await options.bot.sendMessage(channelId, content);
            return { ok: true as const, messageIds };
          } catch (cause) {
            return {
              ok: false as const,
              error: {
                name: cause instanceof Error ? cause.name : "Error",
                message: errorMessage(cause),
              },
            };
          }
        },
      } as never,
    ];

    this.#agent = createAgent({
      id: channelKey(this.scope),
      model: options.model,
      storage,
      systemPrompt: buildCoreSystemPrompt({ channel: this.scope }),
      tools,
      plugins: [
        {
          name: "core.event-format",
          toModelMessages: async (message) => {
            if (message.role !== "custom" || message.type !== "yesimbot.event") return [];
            const formatted = await formatEvent(message as Event, {
              scope: this.scope,
              assetStore: options.assets,
              includeMessageId,
              onAssetMissing: (assetId, cause) => this.warn("asset_missing", { assetId, cause }),
            });
            return formatted ? [formatted] : [];
          },
        },
        createPromptFilePlugin({
          basePath: resolveBasePath(options.config.basePath, options.ctx),
          logger: options.logger,
        }),
        ...plugins,
      ],
      terminalTool: true,
    });
  }

  handle(record: EventRecord): Promise<ChannelRuntime.Result> {
    if (this.#stopped) {
      return Promise.reject(new Error("Channel runtime is stopped"));
    }
    return this.enqueue(async () => {
      this.assertOpen();
      const event = createEvent(record);
      await this.#agent.append(event);
      this.remember(event);
      this.emit("yesimbot/event", event);
      const decision = await this.options.will.decide(event, this.readState());
      this.emit("yesimbot/will", { event, decision } satisfies WillObservation);
      if (decision === "wait") return { kind: "wait", eventId: event.id };

      const activeTurnId = this.#agent.getActiveTurnId();
      if (activeTurnId !== null) {
        this.#agent.send(event, { ifBusy: "join" });
        this.consumePending();
        return { kind: "join", eventId: event.id, turnId: activeTurnId };
      }
      return this.startRun(event);
    });
  }

  async reset(): Promise<void> {
    await this.enqueue(async () => {
      await this.teardown("reset");
      let failure: unknown;
      try {
        await this.#agent.clear();
      } catch (cause) {
        failure = cause;
        this.warn("storage_clear_failed", { cause });
      }
      try {
        await this.options.assets.clear(this.scope);
      } catch (cause) {
        failure ??= cause;
        this.warn("asset_clear_failed", { cause });
      }
      this.#pending = [];
      this.#recent = [];
      this.#lastActivityAt = null;
      if (failure) throw failure;
    });
  }

  stop(): Promise<void> {
    if (this.#stopTask) return this.#stopTask;
    this.#stopped = true;
    this.#stopTask = this.enqueue(async () => {
      await this.teardown("stop");
    });
    return this.#stopTask;
  }

  private async teardown(reason: "reset" | "stop"): Promise<void> {
    try {
      await this.#agent.interrupt(reason);
    } catch (cause) {
      this.warn("agent_interrupt_failed", { cause, reason });
    }
    try {
      await this.#agent.stop();
    } catch (cause) {
      this.warn("agent_stop_failed", { cause, reason });
    }
    try {
      await this.options.will.stop?.();
    } catch (cause) {
      this.warn("will_stop_failed", { cause, reason });
    }
    await Promise.allSettled([...this.#streamTasks]);
  }

  private startRun(event: Event): ChannelRuntime.Result {
    const output = new OutputQueue<ChannelRuntime.Output>();
    const stream = this.#agent.run(event);
    const turnId = this.#agent.getActiveTurnId();
    if (turnId === null) {
      throw new Error("Agent did not expose an active turn after run");
    }
    this.consumePending();
    const task = this.consumeStream(stream, output);
    this.#streamTasks.add(task);
    void task.finally(() => this.#streamTasks.delete(task));
    return { kind: "run", eventId: event.id, turnId, output };
  }

  private async consumeStream(
    stream: AsyncIterable<AgentInternalEvent>,
    output: OutputQueue<ChannelRuntime.Output>,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (isRenderableAssistant(event)) {
          const content = renderAssistantContent(event.message.content);
          if (content !== undefined) {
            output.push({ turnId: event.turnId, messageId: event.message.id, content });
          }
        }
        if (event.type === "turn.failed") throw new Error(event.error.message);
        if (event.type === "turn.aborted") throw new Error("Agent turn aborted");
      }
      output.close();
    } catch (cause) {
      output.close(cause);
    }
  }

  private readState(): Will.State {
    return Object.freeze({
      activeTurnId: this.#agent.getActiveTurnId(),
      pending: Object.freeze([...this.#pending]),
      recent: Object.freeze([...this.#recent]),
      lastActivityAt: this.#lastActivityAt,
    });
  }

  private remember(event: Event): void {
    this.#pending.push(event);
    this.#recent.push(event);
    if (this.#recent.length > MAX_RECENT_EVENTS) this.#recent.shift();
    this.#lastActivityAt = event.timestamp;
  }

  private consumePending(): void {
    this.#pending = [];
  }

  private emit(channel: "yesimbot/event" | "yesimbot/will", value: unknown): void {
    try {
      this.options.ctx.emit(channel, value as never);
    } catch (cause) {
      this.warn("listener_failed", { channel, cause });
    }
  }

  private warn(event: string, fields: Record<string, unknown>): void {
    try {
      this.options.logger.warn({ event, ...fields });
    } catch {}
  }

  private assertOpen(): void {
    if (this.#stopped) throw new Error("Channel runtime is stopped");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export namespace ChannelRuntime {
  export interface Output {
    readonly turnId: string;
    readonly messageId: string;
    readonly content: Fragment;
  }

  export type Result =
    | { readonly kind: "wait"; readonly eventId: string }
    | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
    | {
        readonly kind: "run";
        readonly eventId: string;
        readonly turnId: string;
        readonly output: AsyncIterable<Output>;
      };
}
