import { isAbsolute, resolve } from "node:path";

import {
  createAgent,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentStorage,
  type AgentToolSet,
  type ModelMessageContext,
} from "@yesimbot/agent-runtime";
import type { FilePart, LanguageModel } from "ai";
import type { Bot, Context, Fragment, Logger } from "koishi";
import { z } from "zod";

import { channelKey, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import { formatEvent } from "../event/formatter.js";
import { createEvent, type Event, type EventRecord } from "../event/index.js";
import { selectEventFiles, UnsupportedImageMimeError } from "../event/media.js";
import type { AssetStore } from "../shared/asset.js";
import type { Will, WillObservation } from "../will/index.js";
import { buildCoreSystemPrompt } from "./prompt.js";

export interface MediaPolicy {
  readonly enabled: boolean;
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  readonly strategy: "current-first" | "fifo" | "lifo";
}

export interface ChannelRuntimeOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly will: Will;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly model: LanguageModel;
  readonly imageInput: boolean;
  readonly mediaPolicy: MediaPolicy;
  readonly agentPlugins: readonly AgentPlugin[];
  readonly includeMessageId: boolean;
  readonly storage: AgentStorage;
}

export const MAX_RECENT_EVENTS = 32;

export class ChannelRuntimeDrainingError extends Error {
  constructor() {
    super("Channel runtime is draining");
    this.name = "ChannelRuntimeDrainingError";
  }
}

class OutputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiter:
    | {
        resolve: (result: IteratorResult<T>) => void;
        reject: (cause: unknown) => void;
      }
    | undefined;
  private error: unknown;
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter.resolve({ done: false, value: item });
    else this.items.push(item);
  }

  close(error?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) {
      if (error) waiter.reject(error);
      else waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const item = this.items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.error) throw this.error;
        if (this.done) return { done: true, value: undefined };
        return await new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiter = { resolve, reject };
        });
      },
    };
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

  private tail = Promise.resolve();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private draining = false;
  private deliveryLeases = 0;
  private deliveryWaiters = new Set<() => void>();
  private drainTask: Promise<void> | undefined;
  private streams = new Set<Promise<void>>();
  private pending: Event[] = [];
  private recent: Event[] = [];
  private lastAt: number | null = null;
  private readonly agent: Agent;
  private initTask: Promise<void> | undefined;

  constructor(private readonly opts: ChannelRuntimeOptions) {
    this.scope = Object.freeze({ ...opts.scope });
    const plugins = opts.agentPlugins;
    const includeMessageId = opts.includeMessageId;
    const selectedFilesByContext = new WeakMap<
      ModelMessageContext,
      Promise<ReadonlyMap<Event["id"], readonly FilePart[]>>
    >();
    const basePath = isAbsolute(opts.config.basePath)
      ? opts.config.basePath
      : resolve(opts.ctx.baseDir, opts.config.basePath);
    const tools: AgentToolSet = [
      {
        name: "sendMessage",
        description: "Send a message to an explicit channel using the current bot.",
        inputSchema: z.object({ channelId: z.string().min(1), content: z.string() }),
        execute: async ({ channelId, content }: { channelId: string; content: string }) => {
          try {
            const messageIds = await opts.bot.sendMessage(channelId, content);
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

    this.agent = createAgent({
      id: channelKey(this.scope),
      model: opts.model,
      storage: opts.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({
          basePath,
          channel: this.scope,
          logger: opts.logger,
        }),
      tools,
      plugins: [
        {
          name: "core.event-format",
          toModelMessages: async (message, context) => {
            if (message.role !== "custom" || message.type !== "yesimbot.event") return [];
            const event = message as Event;
            let selectedFiles = selectedFilesByContext.get(context);
            if (!selectedFiles) {
              selectedFiles = selectEventFiles(context, {
                scope: this.scope,
                assetStore: opts.assets,
                imageInput: opts.imageInput,
                policy: opts.mediaPolicy,
                onAssetFailure: (assetId, cause) =>
                  this.warn(
                    cause instanceof UnsupportedImageMimeError
                      ? "asset_invalid_mime"
                      : "asset_read_failed",
                    { assetId, cause },
                  ),
              }).catch((cause: unknown) => {
                this.warn("media_selection_failed", { cause });
                return new Map();
              });
              selectedFilesByContext.set(context, selectedFiles);
            }
            const formatted = formatEvent(event, {
              includeMessageId,
              files: (await selectedFiles).get(event.id),
            });
            return [formatted];
          },
        },
        {
          name: "core.will-reply",
          onTurnFinish: async (result) => {
            const hasRenderableReply = result.messages.some(
              (message) =>
                message.role === "assistant" && renderAssistantContent(message.content) !== undefined,
            );
            if (result.status !== "done" || !hasRenderableReply) return;
            try {
              await opts.will.onReply?.();
            } catch (cause) {
              this.warn("will_reply_failed", { cause });
            }
          },
        },
        ...plugins,
      ],
      terminalTool: true,
    });
  }

  init(): Promise<void> {
    if (!this.initTask) this.initTask = this.agent.init();
    return this.initTask;
  }

  handle(record: EventRecord): Promise<ChannelRuntime.Result> {
    return this.handleRecord(record, false);
  }

  handleInternal(record: EventRecord): Promise<ChannelRuntime.Result> {
    return this.handleRecord(record, true);
  }

  beginDrain(): void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
    this.draining = true;
  }

  acquireDeliveryLease(): () => void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
    this.deliveryLeases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.deliveryLeases -= 1;
      if (this.deliveryLeases === 0) {
        for (const resolve of this.deliveryWaiters) resolve();
        this.deliveryWaiters.clear();
      }
    };
  }

  drainAndStop(): Promise<void> {
    if (this.drainTask) return this.drainTask;
    this.beginDrain();
    this.drainTask = (async () => {
      await this.tail;
      await this.waitForDeliveries();
      await this.agent.wait();
      await Promise.allSettled([...this.streams]);
      this.stopped = true;
      await this.agent.stop();
      await this.opts.will.stop?.();
    })();
    return this.drainTask;
  }

  private handleRecord(record: EventRecord, internal: boolean): Promise<ChannelRuntime.Result> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    if (this.draining && !internal) return Promise.reject(new ChannelRuntimeDrainingError());
    return this.enqueue(async () => {
      this.assertOpen();
      if (this.draining && !internal) throw new ChannelRuntimeDrainingError();
      const event = createEvent(record);
      await this.agent.append(event);
      this.remember(event);
      this.emit("yesimbot/event", event);
      const decision = await this.opts.will.decide(event, this.readState());
      this.emit("yesimbot/will", { event, decision } satisfies WillObservation);
      if (decision === "wait") return { kind: "wait", eventId: event.id };

      const activeTurnId = this.agent.getActiveTurnId();
      if (activeTurnId !== null) {
        this.agent.send(event, { ifBusy: "join" });
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
        await this.agent.clear();
      } catch (cause) {
        failure = cause;
        this.warn("storage_clear_failed", { cause });
      }
      try {
        await this.opts.assets.clear(this.scope);
      } catch (cause) {
        failure ??= cause;
        this.warn("asset_clear_failed", { cause });
      }
      this.pending = [];
      this.recent = [];
      this.lastAt = null;
      if (failure) throw failure;
    });
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.enqueue(async () => {
      await this.teardown("stop");
    });
    return this.stopTask;
  }

  private async teardown(reason: "reset" | "stop"): Promise<void> {
    try {
      await this.agent.interrupt(reason);
    } catch (cause) {
      this.warn("agent_interrupt_failed", { cause, reason });
    }
    try {
      await this.agent.stop();
    } catch (cause) {
      this.warn("agent_stop_failed", { cause, reason });
    }
    try {
      await this.opts.will.stop?.();
    } catch (cause) {
      this.warn("will_stop_failed", { cause, reason });
    }
    await Promise.allSettled([...this.streams]);
  }

  private waitForDeliveries(): Promise<void> {
    if (this.deliveryLeases === 0) return Promise.resolve();
    return new Promise((resolve) => this.deliveryWaiters.add(resolve));
  }

  private startRun(event: Event): ChannelRuntime.Result {
    const output = new OutputQueue<ChannelRuntime.Output>();
    const stream = this.agent.run(event);
    const turnId = this.agent.getActiveTurnId();
    if (turnId === null) {
      throw new Error("Agent did not expose an active turn after run");
    }
    this.consumePending();
    const task = this.consumeStream(stream, output);
    this.streams.add(task);
    void task.finally(() => this.streams.delete(task));
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
      activeTurnId: this.agent.getActiveTurnId(),
      pending: Object.freeze([...this.pending]),
      recent: Object.freeze([...this.recent]),
      lastActivityAt: this.lastAt,
    });
  }

  private remember(event: Event): void {
    this.pending.push(event);
    this.recent.push(event);
    if (this.recent.length > MAX_RECENT_EVENTS) this.recent.shift();
    this.lastAt = event.timestamp;
  }

  private consumePending(): void {
    this.pending = [];
  }

  private emit(channel: "yesimbot/event" | "yesimbot/will", value: unknown): void {
    try {
      this.opts.ctx.emit(channel, value as never);
    } catch (cause) {
      this.warn("listener_failed", { channel, cause });
    }
  }

  private warn(event: string, fields: Record<string, unknown>): void {
    try {
      this.opts.logger.warn({ event, ...fields });
    } catch {}
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.then(
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
