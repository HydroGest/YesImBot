import {
  AgentBusyError,
  AssistantContent,
  createAgent,
  createEntry,
  createEventEntry,
  createInternalEvent,
  createSystemMessage,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentToolSet,
  type LanguageModel,
  type ToolSet,
} from "@yesimbot/agent-runtime";
import { Universal, type Bot, type Context, type Logger } from "koishi";

import {
  createDescribeImageTool,
  createFinishTool,
  createReadTool,
  createSendMessageTool,
  type DeliveredNotice,
  type SendFailedNotice,
} from "../agents/tools.js";
import type { WillEngine, WillState } from "../agents/will.js";
import { deriveChannelKey, type Channel, type ChannelContext } from "../channels/index.js";
import type { Config } from "../config.js";
import {
  createEvent,
  createMessage,
  formatInput,
  isEvent,
  isMessage,
  isMessageRecord,
  type Event,
  type EventRecord,
  type Message,
  type MessageRecord,
} from "../messages/index.js";
import { buildCoreSystemPrompt, readPersona } from "./prompt.js";

const MODEL_INPUT_PLUGIN: AgentPlugin = {
  name: "core.model-input",
  enforce: "pre",
  toModelMessages: async (message) => (isMessage(message) || isEvent(message) ? [formatInput(message)] : []),
};

const COMPACT_HISTORY_PLUGIN: AgentPlugin = {
  name: "core.compact-history",
  enforce: "pre",
  transformEntries: (entries) => {
    const lastCompactIndex = entries.reduce((last, entry, index) => (entry.type === "compact" ? index : last), -1);
    return (lastCompactIndex === -1 ? entries : entries.slice(lastCompactIndex)).map((entry) =>
      entry.type === "compact"
        ? createEntry(
            "message",
            createSystemMessage(`<conversation_memory>\n${entry.data.summary}\n</conversation_memory>`, { id: entry.id, timestamp: entry.timestamp }),
            { id: entry.id, timestamp: entry.timestamp },
          )
        : entry,
    );
  },
};

export type RuntimeResult =
  | { readonly kind: "wait"; readonly eventId: string }
  | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
  /** `done` settles when the turn finishes; delivery already happened inside `send_message`. */
  | { readonly kind: "run"; readonly eventId: string; readonly done: Promise<void> };

export type PostOptions = {
  readonly trigger?: boolean;
  readonly ifBusy?: "defer" | "join" | "reject";
  readonly delivery?: "channel" | "silent";
};

export interface ChannelRuntimeOptions {
  readonly channel: Channel;
  readonly bot: Bot;
  readonly will: WillEngine;
  readonly model: LanguageModel;
  readonly providerTools?: ToolSet;
  readonly visionModel?: LanguageModel;
  readonly imageOutputSupported: boolean;
  readonly config: Config;
  readonly plugins: readonly AgentPlugin[];
  readonly compactModel?: LanguageModel;
  readonly idleTimeout?: number;
  readonly archiveMaxBytes?: number;
}

export class ChannelRuntime {
  public readonly context: ChannelContext;
  public readonly selfId: string;

  private readonly agent: Agent;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();
  private readonly streams = new Set<Promise<void>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private responseCompactionPending = false;
  /** Turns started by a silent post; `send_message` is blocked for them. */
  private readonly silentTurns = new Set<string>();

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
      createSendMessageTool({
        bot: options.bot,
        channelId: this.context.channelId,
        resources: options.channel.resources,
        pacing: options.config.pacing,
        innerThought: options.config.customInnerThought,
        onDelivered: (notice) => this.announceDelivered(notice),
        onFailed: (notice) => this.announceSendFailed(notice),
      }),
      createReadTool(options.channel.resources, options.imageOutputSupported),
      createFinishTool(),
    ];
    if (options.visionModel) {
      tools.push(createDescribeImageTool(options.visionModel, options.channel.resources));
    }
    this.agent = createAgent({
      id: deriveChannelKey(this.context),
      model: options.model,
      storage: options.channel.conversation.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({
          basePath: options.config.basePath,
          channel: this.context,
          selfId: this.selfId,
          customInnerThought: options.config.customInnerThought,
          logger: this.logger,
        }),
      tools,
      providerTools: options.providerTools,
      plugins: [COMPACT_HISTORY_PLUGIN, MODEL_INPUT_PLUGIN, this.silentTurnPlugin(), ...options.plugins],
    });
  }

  public async init(): Promise<void> {
    this.persona = await readPersona(this.options.config.basePath, this.logger);
    await this.agent.init();
  }

  public handle(record: MessageRecord | EventRecord): Promise<RuntimeResult> {
    return this.schedule(async () => {
      const input = await this.persist(record);
      await this.archiveIfOversize();
      const decision = await this.options.will.decide(input, this.state());
      try {
        await this.options.channel.conversation.storage.append(
          createEventEntry(createInternalEvent({ type: "will.decision", eventId: input.id, decision, debug: this.options.will.debug?.() })),
        );
      } catch (error) {
        this.logger.warn("runtime.will_decision_persist_failed", { eventId: input.id, error });
      }
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
      const input = await this.persist(event);
      await this.archiveIfOversize();
      const silent = options.delivery === "silent";
      const result = !trigger ? { kind: "wait" as const, eventId: input.id } : this.start(input, false, ifBusy, silent);
      this.logger.debug("runtime.post", { eventId: input.id, eventType: event.eventType, trigger, ifBusy, silent, result: result.kind });
      return result;
    });
  }

  public wait(): Promise<void> {
    return this.agent.wait();
  }

  public compact(reason: "auto" | "idle" | "manual"): Promise<unknown> {
    return this.schedule(async () => {
      const result = await this.options.channel.conversation.compact(reason, {
        model: this.options.compactModel ?? this.options.model,
        personaName: "Athena",
        persona: this.persona,
      });
      if (result.compacted) await this.archiveIfOversize();
      return result;
    });
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.clearIdleTimer();
    this.stopTask = this.schedule(async () => {
      await this.agent.interrupt("stop");
      await this.agent.stop();
      await Promise.allSettled(this.streams);
    });
    return this.stopTask;
  }

  private async persist(record: MessageRecord | EventRecord): Promise<Message | Event> {
    const input = isMessageRecord(record) ? createMessage(record) : createEvent(record);
    await this.agent.append(input);
    this.ctx.emit(isMessage(input) ? "yesimbot/message" : "yesimbot/event", input as never);
    return input;
  }

  private async commit(record: MessageRecord | EventRecord): Promise<Message | Event> {
    const input = await this.persist(record);
    await this.archiveIfOversize();
    return input;
  }

  private announceDelivered(notice: DeliveredNotice): void {
    if (notice.channelId !== this.context.channelId) return;
    this.ctx.emit("yesimbot/delivered", {
      platform: this.context.platform,
      selfId: this.selfId,
      channel: { id: this.context.channelId, type: this.channelType() },
      messageId: notice.messageId,
      turnId: notice.turnId,
      text: notice.text,
    });
  }

  /** Surfaces send failures to operators; the model already received them as the tool result. */
  private announceSendFailed(notice: SendFailedNotice): void {
    this.ctx.emit(
      "yesimbot/event",
      createEvent({
        eventType: "delivery.failed",
        platform: this.context.platform,
        selfId: this.selfId,
        channel: { id: notice.channelId, type: this.channelType() },
        timestamp: Date.now(),
        text: "delivery failed",
        delivery: {
          turnId: notice.turnId,
          messageId: "",
          segmentIndex: notice.failedAt + 1,
          segmentTotal: notice.total,
          error: notice.error,
        },
      }),
    );
  }

  private channelType(): Universal.Channel["type"] {
    return this.context.type === "direct" ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT;
  }

  private start(input: Message | Event, passive: boolean, ifBusy: "defer" | "join" | "reject", silent = false): RuntimeResult {
    const activeTurnId = this.agent.getActiveTurnId();
    if (ifBusy === "join" && activeTurnId !== null) {
      this.agent.send(input, { ifBusy: "join" });
      return { kind: "join", eventId: input.id, turnId: activeTurnId };
    }
    const task = this.consume(this.agent.run(input, { ifBusy: ifBusy === "join" ? "defer" : ifBusy }), passive, silent);
    this.streams.add(task);
    void task.finally(() => this.streams.delete(task));
    return { kind: "run", eventId: input.id, done: task };
  }

  private async consume(stream: AsyncIterable<AgentInternalEvent>, passive: boolean, silent: boolean): Promise<void> {
    let delivered = false;
    let completed = false;
    let turnId = "";
    try {
      for await (const event of stream) {
        if (event.type === "turn.start") {
          turnId = event.turnId;
          if (silent) this.silentTurns.add(event.turnId);
          this.logger.debug("runtime.turn.start", { turnId: event.turnId, silent });
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
          if (event.toolName === "send_message" && (event.result as { ok?: boolean } | undefined)?.ok === true) delivered = true;
          this.logger.debug("runtime.tool.done", { turnId: event.turnId, toolName: event.toolName, toolCallId: event.toolCallId });
          continue;
        }
        if (event.type === "tool.failed") {
          this.logger.warn("runtime.tool.failed", { turnId: event.turnId, toolName: event.toolName, toolCallId: event.toolCallId, error: event.error.message });
          continue;
        }
        if (event.type === "message.appended" && "turnId" in event && event.message.role === "assistant") {
          turnId = event.turnId;
          // Model text is internal reasoning space: it is recorded and logged, never delivered.
          const content = renderAssistantText(event.message.content);
          if (content !== undefined) {
            this.logger.debug("runtime.output.text", { turnId, messageId: event.message.id, text: content.slice(0, 2000) });
          }
          continue;
        }
        if (event.type === "turn.failed") {
          this.logger.warn("runtime.turn.failed", { turnId: event.turnId, error: event.error.message });
          return;
        }
        if (event.type === "turn.aborted") {
          this.logger.warn("runtime.turn.aborted", { turnId: event.turnId, reason: event.reason });
          return;
        }
      }
      completed = true;
      if (passive) await this.options.will.observe?.({ turnId, status: "done", messages: [] });
    } catch (error) {
      this.logger.warn("runtime.turn.consume_failed", { turnId, error });
    } finally {
      if (turnId) this.silentTurns.delete(turnId);
      if (completed && delivered) {
        this.responseCompactionPending = false;
        this.resetIdleTimer();
      } else if (this.responseCompactionPending && this.agent.getActiveTurnId() === null) {
        this.responseCompactionPending = false;
        void this.compact("idle");
      }
      this.scheduleArchiveCheck();
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

  private scheduleArchiveCheck(): void {
    if (this.stopped || (this.options.archiveMaxBytes ?? 0) <= 0) return;
    void this.schedule(async () => {
      if (this.stopped || this.agent.getActiveTurnId() !== null) return;
      await this.archiveIfOversize();
    });
  }

  private async archiveIfOversize(): Promise<void> {
    const maxBytes = this.options.archiveMaxBytes ?? 0;
    if (this.stopped || maxBytes <= 0) return;
    await this.options.channel.conversation.archiveIfOversize(maxBytes, {
      model: this.options.compactModel ?? this.options.model,
      personaName: "Athena",
      persona: this.persona,
    });
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.stopped || !this.options.idleTimeout) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.agent.getActiveTurnId() !== null) {
        this.responseCompactionPending = true;
        return;
      }
      void this.compact("idle");
    }, this.options.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /** Silent posts must not reach the channel, so `send_message` is refused for their turns. */
  private silentTurnPlugin(): AgentPlugin {
    return {
      name: "core.silent-turn",
      beforeToolCall: (call, context) =>
        call.toolName === "send_message" && this.silentTurns.has(context.turnId)
          ? { type: "block", reason: "本轮是静默后台任务，不能向频道发送消息。完成任务后调用 finish 结束本轮。" }
          : { type: "allow" },
    };
  }
}

function renderAssistantText(content: AssistantContent): string | undefined {
  if (typeof content === "string") return content.trim() ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content.map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : "")).join("");
  return text.trim() ? text : undefined;
}
