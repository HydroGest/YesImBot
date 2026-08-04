import { isAbsolute, resolve } from "node:path";

import {
  createAgent,
  jsonSchema,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentStorage,
  type AgentTool,
  type AgentToolSet,
} from "@yesimbot/agent-runtime";
import type { AssistantContent, LanguageModel } from "ai";
import type { Bot, Context, Element, Logger } from "koishi";

import type { ArtifactStore } from "../artifact.js";
import type { AssetStore } from "../asset.js";
import type { Config, ImageBudget } from "../config.js";
import {
  createEvent,
  createMessage,
  isEvent,
  isMessage,
  isMessageRecord,
  type Event,
  type EventRecord,
  type Message,
  type MessageRecord,
} from "../messages.js";
import { createModelInputPlugin } from "./model-input.js";
import { OutputQueue } from "./output-queue.js";
import { prepareOutputSegments } from "./output.js";
import { buildCoreSystemPrompt } from "./prompt.js";
import {
  createReadProjectionPlugin,
  createResourceReader,
  type ResourceReadResult,
  type ResourceReader,
  type ResourceSchemeOpenHandler,
} from "./read.js";
import { parseReply } from "./reply.js";
import { ChannelScope, scopeMapKey } from "./storage.js";
import type { WillEngine } from "./will.js";

export interface ChannelRuntimeOptions {
  readonly config: Config;
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly will: WillEngine;
  readonly assets: AssetStore;
  readonly artifacts: ArtifactStore;
  readonly registrations: ReadonlyMap<string, { prompt: string; open: ResourceSchemeOpenHandler }>;
  readonly model: LanguageModel;
  readonly imageBudget: ImageBudget | null;
  readonly imageCapable: boolean;
  readonly agentPlugins: readonly AgentPlugin[];
  readonly storage: AgentStorage;
  readonly idleTimeout?: number;
  readonly compact?: () => Promise<void>;
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

interface SendMessageInput {
  channelId: string;
  content: string;
}

type SendMessageResult = { ok: true; messageIds: string[] } | { ok: false; error: { name: string; message: string } };

export class ChannelRuntime {
  public readonly scope: ChannelScope;
  public readonly selfId: string;

  private readonly ctx: Context;
  private readonly logger: Logger;

  private readonly opts: ChannelRuntimeOptions;

  private tail: Promise<void> = Promise.resolve();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private streams = new Set<Promise<void>>();
  private controllers = new Set<AbortController>();
  private readonly agent: Agent;
  private readonly reader: ResourceReader;
  private initTask: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly idleTimeout: number;

  constructor(ctx: Context, opts: ChannelRuntimeOptions) {
    this.ctx = ctx;
    this.logger = this.ctx.logger("yesimbot/channel-runtime");
    this.opts = opts;
    this.idleTimeout = opts.idleTimeout ?? 0;

    this.scope = { ...opts.scope };
    this.selfId = opts.bot.selfId;
    const basePath = isAbsolute(opts.config.basePath)
      ? opts.config.basePath
      : resolve(this.ctx.baseDir, opts.config.basePath);
    const sendMessageTool: AgentTool<SendMessageInput, SendMessageResult> = {
      name: "sendMessage",
      description:
        "使用当前 Bot 向指定频道发送一条消息。img/file 的 src 可使用 asset://、artifact:// 或 workspace:// 引用现有频道资源，Core 会在发送前解析。",
      inputSchema: jsonSchema<SendMessageInput>({
        type: "object",
        properties: {
          channelId: {
            type: "string",
            minLength: 1,
            description: "要发送消息的目标频道 ID",
          },
          content: { type: "string", description: "要发送的消息内容" },
        },
        required: ["channelId", "content"],
      }),
      execute: async ({ channelId, content }, execution) => {
        this.logger.info({ event: "send_message", channelId, content });
        try {
          const segments = await prepareOutputSegments(parseReply(content), this.reader, {
            signal: execution.abortSignal,
            warn: (event, fields) => this.logger.warn({ event, ...fields }),
          });
          const messageIds = await opts.bot.sendMessage(channelId, segments.flat());
          return { ok: true, messageIds };
        } catch (cause) {
          return {
            ok: false,
            error: {
              name: cause instanceof Error ? cause.name : "Error",
              message: errorMessage(cause),
            },
          };
        }
      },
    };
    const reader = createResourceReader({
      scope: this.scope,
      assets: opts.assets,
      artifacts: opts.artifacts,
      registrations: new Map(opts.registrations),
      config: opts.config,
    });
    this.reader = reader;
    const readTool: AgentTool<{ uri: string }, object> = {
      name: "read",
      description: buildReadDescription(opts.registrations),
      inputSchema: jsonSchema<{ uri: string }>({
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "要读取的资源 URI",
          },
        },
        required: ["uri"],
      }),
      execute: async ({ uri }, execution) => {
        this.logger.info({ event: "resource_read", uri });
        return reader.read(uri, execution.abortSignal);
      },
    };
    const tools: AgentToolSet = [sendMessageTool, readTool];
    this.agent = createAgent({
      id: scopeMapKey(this.scope),
      model: opts.model,
      storage: opts.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({
          basePath,
          channel: this.scope,
          logger: this.logger,
          customInnerThought: opts.config.reply.customInnerThought,
        }),
      tools,
      plugins: [
        createModelInputPlugin({
          imageBudget: opts.imageBudget,
          warn: (event, fields) => this.logger.warn({ event, ...fields }),
        }),
        createReadProjectionPlugin(reader, opts.imageCapable, opts.imageBudget),
        ...opts.agentPlugins,
      ],
      terminalTool: true,
    });
  }

  public init(): Promise<void> {
    if (!this.initTask) this.initTask = this.initialize();
    return this.initTask;
  }

  public stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.clearIdleTimer();
    for (const controller of this.controllers) controller.abort();
    this.stopTask = this.schedule(async () => this.teardown("stop"));
    return this.stopTask;
  }

  public handle(record: MessageRecord | EventRecord): Promise<ChannelRuntimeResult> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    this.clearIdleTimer();
    return this.schedule(async () => {
      this.assertOpen();
      const input = await this.commit(record);
      const decision = await this.opts.will.decide(input, this.readState());
      return this.applyDecision(input, decision);
    });
  }

  public trigger(record: EventRecord): Promise<ChannelRuntimeResult> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    this.clearIdleTimer();
    return this.schedule(async () => {
      this.assertOpen();
      const input = await this.commit(record);
      const activeTurnId = this.agent.getActiveTurnId();
      if (activeTurnId !== null) {
        this.agent.send(input, { ifBusy: "join" });
        return { kind: "join", eventId: input.id, turnId: activeTurnId };
      }
      return this.startRun(input);
    });
  }
  public compact(operation: () => Promise<void>): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    return this.schedule(operation);
  }

  private async commit(record: MessageRecord | EventRecord): Promise<Message | Event> {
    const input = isMessageRecord(record) ? createMessage(record) : createEvent(record);
    await this.agent.append(input);
    if (isMessage(input)) {
      this.ctx.emit("yesimbot/message", input);
    } else if (isEvent(input)) {
      this.ctx.emit("yesimbot/event", input);
    }
    this.resetIdleTimer();
    return input;
  }

  private async applyDecision(input: Message | Event, decision: "wait" | "trigger"): Promise<ChannelRuntimeResult> {
    if (decision === "wait") return { kind: "wait", eventId: input.id };
    const activeTurnId = this.agent.getActiveTurnId();
    if (activeTurnId !== null) {
      this.agent.send(input, { ifBusy: "join" });
      return { kind: "join", eventId: input.id, turnId: activeTurnId };
    }
    return this.startRun(input);
  }

  private async teardown(reason: "stop"): Promise<void> {
    try {
      await this.agent.interrupt(reason);
    } catch (cause) {
      this.logger.warn("agent_interrupt_failed", { cause, reason });
    }
    try {
      await this.agent.stop();
    } catch (cause) {
      this.logger.warn("agent_stop_failed", { cause, reason });
    }
    try {
      await this.opts.will.stop?.();
    } catch (cause) {
      this.logger.warn("will_stop_failed", { cause, reason });
    }
    await Promise.allSettled([...this.streams]);
  }

  private startRun(input: Message | Event): ChannelRuntimeResult {
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
            this.logger.warn("will_reply_failed", { cause });
          }
        },
        fail: async (record) => {
          if (this.stopped) throw new Error("Channel runtime is stopped");
          await this.schedule(async () => {
            await this.commit(record);
          });
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
          if (segments !== undefined) {
            const prepared = await prepareOutputSegments(segments, this.reader, {
              signal: controller.signal,
              warn: (event, fields) => this.logger.warn({ event, ...fields }),
            });
            output.push({ turnId: event.turnId, messageId: event.message.id, segments: prepared });
          }
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
    } finally {
      this.resetIdleTimer();
    }
  }

  private async initialize(): Promise<void> {
    await this.agent.init();
    if (this.idleTimeout <= 0) return;
    const lastEntry = (await this.opts.storage.read()).at(-1);
    if (!lastEntry) return;
    this.resetIdleTimer(Math.max(0, this.idleTimeout - (Date.now() - lastEntry.timestamp)));
  }

  private resetIdleTimer(delay = this.idleTimeout): void {
    this.clearIdleTimer();
    if (this.stopped || this.idleTimeout <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.queueIdleCompact();
    }, delay);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private queueIdleCompact(): void {
    if (!this.opts.compact) return;
    void this.schedule(async () => {
      if (this.stopped || this.agent.getActiveTurnId() !== null || !this.agent.isIdle()) return;
      await this.opts.compact?.();
    }).catch((cause) => this.logger.warn("idle_compact_failed", { cause }));
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
  return event.type === "message.appended" && "turnId" in event && event.message.role === "assistant";
}

export function renderAssistantText(content: AssistantContent): string | undefined {
  if (typeof content === "string") return content.trim().length > 0 ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item.type === "text") return item.text;
    })
    .join("");
  return text.trim().length > 0 ? text : undefined;
}

export function parseAssistantContent(content: AssistantContent): Element[][] | undefined {
  const text = renderAssistantText(content);
  return text === undefined ? undefined : parseReply(text);
}

function buildReadDescription(registrations: ReadonlyMap<string, { prompt: string }>): string {
  const lines = [
    "读取资源内容。仅在确实需要内容时读取精确 URI。支持以下 URI 方案：",
    "- asset://<id>: 平台输入的不可变图片资源",
    "- artifact://<tool>/<uuid>: 工具输出的不可变工件",
    "- workspace:///<path>: 工作区文件（可变）",
    "- skill://<name>/<path>: 只读技能文件（仅在 Workspace 启用时）",
  ];
  for (const [scheme, { prompt }] of [...registrations.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`- ${scheme}://: ${prompt}`);
  }
  lines.push("");
  lines.push("URI 字符串永不传给 Bash。仅在图像能力模型显式相关读取后投影图像字节；读取不会创建另一个 artifact。");
  return lines.join("\n");
}
