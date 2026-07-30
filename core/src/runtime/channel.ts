import { isAbsolute, resolve } from "node:path";

import {
  createAgent,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentStorage,
  type AgentTool,
  type AgentToolSet,
} from "@yesimbot/agent-runtime";
import type { LanguageModel } from "ai";
import type { Bot, Context, Element, Logger } from "koishi";
import { z } from "zod";

import type { AssetStore } from "../asset.js";
import { scopeMapKey, type ChannelScope } from "../channel.js";
import type { Config, ImageBudget } from "../config.js";
import type { EventRecord, InputRecord } from "../input.js";
import { createInput, type Input } from "../input.js";
import { createModelInputPlugin } from "./model-input.js";
import { OutputQueue } from "./output-queue.js";
import { buildCoreSystemPrompt } from "./prompt.js";
import { parseReply } from "./reply.js";
import type { WillEngine, WillEngineObservation } from "./will.js";

export interface ChannelRuntimeOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly will: WillEngine;
  readonly assets: AssetStore;
  readonly model: LanguageModel;
  readonly imageBudget: ImageBudget | null;
  readonly agentPlugins: readonly AgentPlugin[];
  readonly includeMessageId: boolean;
  readonly storage: AgentStorage;
}

export type ChannelOutput = {
  readonly turnId: string;
  readonly messageId: string;
  readonly segments: readonly Element[][];
};

export type ChannelRuntimeResult =
  | { readonly kind: "wait"; readonly eventId: string }
  | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
  | {
      readonly kind: "run";
      readonly eventId: string;
      readonly turnId: string;
      readonly output: AsyncIterable<ChannelOutput>;
      readonly delivery: {
        readonly signal: AbortSignal;
        onDelivered(): Promise<void>;
        fail(record: EventRecord<"delivery.failed">): Promise<void>;
      };
    };

export class ChannelRuntime {
  readonly scope: ChannelScope;
  readonly selfId: string;

  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private streams = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private readonly agent: Agent;
  private initTask: Promise<void> | undefined;

  constructor(private readonly opts: ChannelRuntimeOptions) {
    this.scope = { ...opts.scope };
    this.selfId = opts.bot.selfId;
    const basePath = isAbsolute(opts.config.basePath)
      ? opts.config.basePath
      : resolve(opts.ctx.baseDir, opts.config.basePath);
    const sendMessageTool: AgentTool<
      { readonly channelId: string; readonly content: string },
      | { readonly ok: true; readonly messageIds: string[] }
      | { readonly ok: false; readonly error: { readonly name: string; readonly message: string } }
    > = {
      name: "sendMessage",
      description: "Send a message to an explicit channel using the current bot.",
      inputSchema: z.object({ channelId: z.string().min(1), content: z.string() }),
      execute: async ({ channelId, content }) => {
        try {
          return { ok: true as const, messageIds: await opts.bot.sendMessage(channelId, content) };
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
    };
    const tools: AgentToolSet = [sendMessageTool];
    this.agent = createAgent({
      id: scopeMapKey(this.scope),
      model: opts.model,
      storage: opts.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({ basePath, channel: this.scope, logger: opts.logger }),
      tools,
      plugins: [
        createModelInputPlugin({
          assets: opts.assets,
          imageBudget: opts.imageBudget,
          includeMessageId: opts.includeMessageId,
          warn: (event, fields) => this.warn(event, fields),
        }),
        ...opts.agentPlugins,
      ],
      terminalTool: true,
    });
  }

  init(): Promise<void> {
    if (!this.initTask) this.initTask = this.agent.init();
    return this.initTask;
  }

  handle(record: InputRecord): Promise<ChannelRuntimeResult> {
    return this.handleRecord(record);
  }

  handleInternal(record: EventRecord): Promise<ChannelRuntimeResult> {
    return this.handleRecord(record);
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    this.stopTask = this.schedule(async () => this.teardown("stop"));
    return this.stopTask;
  }

  private handleRecord(record: InputRecord): Promise<ChannelRuntimeResult> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    return this.schedule(async () => {
      this.assertOpen();
      const input = createInput(record);
      await this.agent.append(input);
      this.emit("yesimbot/event", input);
      const decision = await this.opts.will.decide(input, this.readState());
      this.emit("yesimbot/will", { event: input, decision } satisfies WillEngineObservation);
      if (decision === "wait") return { kind: "wait", eventId: input.id };
      const activeTurnId = this.agent.getActiveTurnId();
      if (activeTurnId !== null) {
        this.agent.send(input, { ifBusy: "join" });
        return { kind: "join", eventId: input.id, turnId: activeTurnId };
      }
      return this.startRun(input);
    });
  }

  private async teardown(reason: "stop"): Promise<void> {
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

  private startRun(input: Input): ChannelRuntimeResult {
    const output = new OutputQueue<ChannelOutput>();
    const controller = new AbortController();
    this.controllers.add(controller);
    const stream = this.agent.run(input);
    const turnId = this.agent.getActiveTurnId();
    if (turnId === null) throw new Error("Agent did not expose an active turn after run");
    const task = this.consumeStream(stream, output, controller);
    this.streams.add(task);
    void task.finally(() => this.streams.delete(task));
    return {
      kind: "run",
      eventId: input.id,
      turnId,
      output: this.withDelivery(output, controller),
      delivery: {
        signal: controller.signal,
        onDelivered: async () => {
          try {
            await this.opts.will.onReply?.();
          } catch (cause) {
            this.warn("will_reply_failed", { cause });
          }
        },
        fail: async (record) => {
          void this.handleInternal(record).catch((cause) =>
            this.warn("delivery.failed", { cause }),
          );
        },
      },
    };
  }

  private async consumeStream(
    stream: AsyncIterable<AgentInternalEvent>,
    output: OutputQueue<ChannelOutput>,
    controller: AbortController,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (isAssistantMessage(event)) {
          const segments = parseAssistantContent(event.message.content);
          if (segments !== undefined)
            output.push({ turnId: event.turnId, messageId: event.message.id, segments });
        }
        if (event.type === "turn.failed") {
          controller.abort();
          throw new Error(event.error.message);
        }
        if (event.type === "turn.aborted") {
          controller.abort();
          throw new Error("Agent turn aborted");
        }
      }
      output.close();
    } catch (cause) {
      output.close(cause);
    }
  }

  private readState(): WillEngine.State {
    return { activeTurnId: this.agent.getActiveTurnId() };
  }

  private async *withDelivery(
    output: OutputQueue<ChannelOutput>,
    controller: AbortController,
  ): AsyncIterable<ChannelOutput> {
    try {
      yield* output;
    } finally {
      this.controllers.delete(controller);
    }
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function isAssistantMessage(event: AgentInternalEvent): event is AgentInternalEvent & {
  readonly type: "message.appended";
  readonly turnId: string;
  readonly message: { readonly id: string; readonly role: "assistant"; readonly content: unknown };
} {
  return (
    event.type === "message.appended" && "turnId" in event && event.message.role === "assistant"
  );
}

export function renderAssistantText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim().length > 0 ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(
      (part): part is { readonly type: "text"; readonly text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  return text.trim().length > 0 ? text : undefined;
}

export function parseAssistantContent(content: unknown): Element[][] | undefined {
  const text = renderAssistantText(content);
  return text === undefined ? undefined : parseReply(text);
}
