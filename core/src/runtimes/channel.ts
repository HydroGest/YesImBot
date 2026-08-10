import { AgentBusyError, createAgent, type Agent, type AgentInternalEvent, type AgentPlugin, type AgentToolSet } from "@yesimbot/agent-runtime";
import type { AssistantContent, LanguageModel } from "ai";
import { type Bot, type Context, type Element, type Logger } from "koishi";

import { createDescribeImageTool, createReadTool, createSendMessageTool } from "../agents/tools.js";
import type { WillEngine, WillState } from "../agents/will.js";
import { type Channel, type ChannelContext, deriveChannelKey } from "../channels/index.js";
import type { Config } from "../config.js";
import {
  createEvent,
  createMessage,
  formatInput,
  parseReply,
  isEvent,
  isMessage,
  isMessageRecord,
  type Event,
  type EventRecord,
  type Message,
  type MessageRecord,
} from "../messages/index.js";
import { prepareOutputSegments } from "../resources/index.js";
import { OutputQueue } from "./output.js";
import { buildCoreSystemPrompt, readPersona } from "./prompt.js";
const MODEL_INPUT_PLUGIN: AgentPlugin = {
  name: "core.model-input",
  enforce: "pre",
  toModelMessages: async (message) => (isMessage(message) || isEvent(message) ? [formatInput(message)] : []),
};
export type ChannelOutput = { readonly turnId: string; readonly messageId: string; readonly segments: readonly Element[][] };
export type RuntimeResult =
  | { readonly kind: "wait"; readonly eventId: string }
  | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
  | { readonly kind: "run"; readonly eventId: string; readonly output: AsyncIterable<ChannelOutput>; readonly signal: AbortSignal };
export type PostOptions = { readonly trigger?: boolean; readonly ifBusy?: "defer" | "join" | "reject" };
export interface ChannelRuntimeOptions {
  readonly channel: Channel;
  readonly bot: Bot;
  readonly will: WillEngine;
  readonly model: LanguageModel;
  readonly visionModel?: LanguageModel;
  readonly imageOutputSupported: boolean;
  readonly config: Config;
  readonly plugins: readonly AgentPlugin[];
  readonly idleTimeout?: number;
}
export class ChannelRuntime {
  public readonly context: ChannelContext;
  public readonly selfId: string;

  private readonly agent: Agent;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();
  private readonly streams = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  private persona = "";
  public constructor(
    private readonly ctx: Context,
    private readonly options: ChannelRuntimeOptions,
  ) {
    this.context = options.channel.context;
    this.selfId = options.bot.selfId;
    this.logger = ctx.logger("yesimbot/channel-runtime");
    this.logger.level = options.config.logLevel ?? 2;
    const tools: AgentToolSet = [
      createSendMessageTool(options.bot, this.context.channelId, options.channel.resources),
      createReadTool(options.channel.resources, options.imageOutputSupported),
    ];
    if (options.visionModel) tools.push(createDescribeImageTool(options.visionModel, options.channel.resources));
    this.agent = createAgent({
      id: deriveChannelKey(this.context),
      model: options.model,
      storage: options.channel.conversation.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({
          basePath: options.config.basePath,
          channel: this.context,
          selfId: this.selfId,
          logger: this.logger,
          customInnerThought: options.config.reply.customInnerThought,
        }),
      tools,
      plugins: [MODEL_INPUT_PLUGIN, ...options.plugins],
    });
  }

  public async init(): Promise<void> {
    this.persona = await readPersona(this.options.config.basePath, this.logger);
    await this.agent.init();
  }

  public handle(record: MessageRecord | EventRecord): Promise<RuntimeResult> {
    return this.schedule(async () => {
      const input = await this.commit(record);
      const decision = await this.options.will.decide(input, this.state());
      const result = decision === "wait" ? { kind: "wait" as const, eventId: input.id } : this.start(input, true, "join");
      this.logger.debug("runtime.handle", {
        eventId: input.id,
        eventType: "messageId" in record ? "message" : "event",
        decision,
        result: result.kind,
        activeTurnId: this.state().activeTurnId,
      });
      return result;
    });
  }

  public post(event: EventRecord, options: PostOptions = {}): Promise<RuntimeResult> {
    const trigger = options.trigger ?? true;
    const ifBusy = options.ifBusy ?? "defer";
    return this.schedule(async () => {
      this.assertOpen();
      if (trigger && ifBusy === "reject" && this.agent.getActiveTurnId() !== null) throw new AgentBusyError();
      const input = await this.commit(event);
      const result = !trigger ? { kind: "wait" as const, eventId: input.id } : this.start(input, false, ifBusy);
      this.logger.debug("runtime.post", {
        eventId: input.id,
        eventType: event.eventType,
        trigger,
        ifBusy,
        result: result.kind,
      });
      return result;
    });
  }

  public fail(eventId: string, cause: unknown, delivery?: { turnId: string; messageId: string; segmentIndex: number; segmentTotal: number }): Promise<void> {
    return this.schedule(async () => {
      const input = createEvent({
        eventType: "delivery.failed",
        platform: this.context.platform,
        selfId: this.selfId,
        channel: { id: this.context.channelId, type: this.context.type === "direct" ? 1 : 0 },
        timestamp: Date.now(),
        text: "delivery failed",
        delivery: {
          turnId: delivery?.turnId ?? "",
          messageId: delivery?.messageId ?? eventId,
          segmentIndex: delivery?.segmentIndex ?? 0,
          segmentTotal: delivery?.segmentTotal ?? 0,
          error: { name: cause instanceof Error ? cause.name : "Error", message: cause instanceof Error ? cause.message : String(cause) },
        },
      });
      await this.agent.append(input);
      this.ctx.emit("yesimbot/event", input);
    });
  }

  public wait(): Promise<void> {
    return this.agent.wait();
  }

  public compact(reason: "auto" | "idle" | "manual"): Promise<unknown> {
    return this.schedule(() => this.options.channel.conversation.compact(reason, { model: this.options.model, personaName: "Athena", persona: this.persona }));
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.clearIdleTimer();
    for (const controller of this.controllers) controller.abort();
    this.stopTask = this.schedule(async () => {
      await this.agent.interrupt("stop");
      await this.agent.stop();
      await Promise.allSettled([...this.streams]);
    });
    return this.stopTask;
  }

  private async commit(record: MessageRecord | EventRecord): Promise<Message | Event> {
    const input = isMessageRecord(record) ? createMessage(record) : createEvent(record);
    await this.agent.append(input);
    this.ctx.emit(isMessage(input) ? "yesimbot/message" : "yesimbot/event", input as never);
    this.resetIdleTimer();
    return input;
  }

  private start(input: Message | Event, passive: boolean, ifBusy: "defer" | "join" | "reject"): RuntimeResult {
    const activeTurnId = this.agent.getActiveTurnId();
    if (ifBusy === "join" && activeTurnId !== null) {
      this.agent.send(input, { ifBusy: "join" });
      return { kind: "join", eventId: input.id, turnId: activeTurnId };
    }
    const controller = new AbortController();
    const queue = new OutputQueue<ChannelOutput>();
    const task = this.consume(this.agent.run(input, { ifBusy: ifBusy === "join" ? "defer" : ifBusy }), queue, controller, passive);
    this.controllers.add(controller);
    this.streams.add(task);
    void task.finally(() => {
      this.controllers.delete(controller);
      this.streams.delete(task);
    });
    return { kind: "run", eventId: input.id, output: queue, signal: controller.signal };
  }

  private async consume(
    stream: AsyncIterable<AgentInternalEvent>,
    output: OutputQueue<ChannelOutput>,
    controller: AbortController,
    passive: boolean,
  ): Promise<void> {
    let assistant = false;
    let turnId = "";
    try {
      for await (const event of stream) {
        if (event.type === "turn.start") {
          this.logger.debug("runtime.turn.start", { turnId: event.turnId });
          continue;
        }
        if (event.type === "turn.step") {
          this.logger.debug("runtime.turn.step", {
            turnId: event.turnId,
            stepNumber: event.step,
            finishReason: event.finishReason,
            usage: event.usage,
            reasoningText: event.reasoningText === undefined ? undefined : event.reasoningText.slice(0, 1000),
          });
          continue;
        }
        if (event.type === "turn.done") {
          this.logger.debug("runtime.turn.done", { turnId: event.turnId });
          continue;
        }
        if (event.type === "tool.start") {
          this.logger.debug("runtime.tool.start", { turnId: event.turnId, toolName: event.toolName, toolCallId: event.toolCallId });
          continue;
        }
        if (event.type === "tool.done") {
          this.logger.debug("runtime.tool.done", { turnId: event.turnId, toolName: event.toolName, toolCallId: event.toolCallId });
          continue;
        }
        if (event.type === "tool.failed") {
          this.logger.warn("runtime.tool.failed", {
            turnId: event.turnId,
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            error: event.error.message,
          });
          continue;
        }
        if (event.type === "message.appended" && "turnId" in event && event.message.role === "assistant") {
          turnId = event.turnId;
          const content = renderAssistantText(event.message.content);
          if (content !== undefined) {
            const segments = await prepareOutputSegments(parseReply(content), this.options.channel.resources, controller.signal);
            if (segments.length) {
              this.logger.debug("runtime.output.segments", { turnId, messageId: event.message.id, segmentCount: segments.length });
              output.push({ turnId, messageId: event.message.id, segments });
              assistant = true;
            }
          }
        }
        if (event.type === "turn.failed") {
          this.logger.warn("runtime.turn.failed", { turnId: event.turnId, error: event.error.message });
          throw new Error(event.error.message);
        }
        if (event.type === "turn.aborted") {
          this.logger.warn("runtime.turn.aborted", { turnId: event.turnId, reason: event.reason });
          throw new Error("Agent turn aborted");
        }
      }
      if (passive && assistant) await this.options.will.observe?.({ turnId, status: "done", messages: [] });
      output.close();
    } catch (cause) {
      output.close(cause);
    } finally {
      this.resetIdleTimer();
    }
  }

  private state(): WillState {
    return { activeTurnId: this.agent.getActiveTurnId() };
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.stopped || !this.options.idleTimeout) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.agent.getActiveTurnId() === null) void this.compact("idle");
    }, this.options.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
function renderAssistantText(content: AssistantContent): string | undefined {
  if (typeof content === "string") return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : "")).join("");
  return text.trim() ? text : undefined;
}
