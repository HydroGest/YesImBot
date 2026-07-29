import { isAbsolute, resolve } from "node:path";

import {
  createAgent,
  type Agent,
  type AgentInternalEvent,
  type AgentPlugin,
  type AgentStorage,
  type AgentTool,
  type AgentToolSet,
  type ModelMessageContext,
} from "@yesimbot/agent-runtime";
import type { FilePart, LanguageModel } from "ai";
import type { Bot, Context, Element, Logger } from "koishi";
import { z } from "zod";

import { channelIdentity, type ChannelScope } from "../channel/index.js";
import type { Config } from "../config.js";
import { formatInput } from "../event/formatter.js";
import type { EventRecord, InputRecord } from "../input.js";
import { createInput, isInput, type Input } from "../input.js";
import type { AssetStore } from "../media/index.js";
import {
  selectInputFiles,
  UnsupportedImageMimeError,
  type UnifiedImagePolicy,
} from "../media/index.js";
import { parseReply } from "../reply/parse.js";
import { buildCoreSystemPrompt } from "./prompt.js";
import { createDeliveryState, OutputQueue } from "./delivery.js";
import { serialQueue, type SerialQueue } from "./serial-queue.js";
import type { WillEngine, WillEngineObservation } from "./will.js";

export interface ChannelRuntimeOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly scope: ChannelScope;
  readonly bot: Bot;
  readonly will: WillEngine;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly model: LanguageModel;
  readonly provider: string;
  readonly imageInput: boolean;
  readonly mediaPolicy: UnifiedImagePolicy;
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
    };

export class ChannelRuntimeDrainingError extends Error {
  constructor() {
    super("Channel runtime is draining");
    this.name = "ChannelRuntimeDrainingError";
  }
}

export class ChannelRuntime {
  readonly scope: ChannelScope;

  private readonly queue: SerialQueue = serialQueue();
  private stopped = false;
  private stopTask: Promise<void> | undefined;
  private draining = false;
  private drainTask: Promise<void> | undefined;
  private streams = new Set<Promise<void>>();
  private readonly agent: Agent;
  private readonly delivery;
  private initTask: Promise<void> | undefined;

  constructor(private readonly opts: ChannelRuntimeOptions) {
    this.scope = Object.freeze({ ...opts.scope });
    this.delivery = createDeliveryState({
      onReply: opts.will.onReply
        ? async () => {
            await opts.will.onReply?.();
          }
        : undefined,
      warn: (event, fields) => this.warn(event, fields),
    });
    const selectedFilesByContext = new WeakMap<
      ModelMessageContext,
      Promise<ReadonlyMap<Input["id"], readonly FilePart[]>>
    >();
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
      id: channelIdentity(this.scope),
      model: opts.model,
      storage: opts.storage,
      systemPrompt: () =>
        buildCoreSystemPrompt({ basePath, channel: this.scope, logger: opts.logger }),
      tools,
      plugins: [
        {
          name: "core.event-format",
          enforce: "pre",
          toModelMessages: async (message, context) => {
            if (!isInput(message)) return [];
            let selectedFiles = selectedFilesByContext.get(context);
            if (!selectedFiles) {
              selectedFiles = selectInputFiles(context, {
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
            return [
              formatInput(message, {
                includeMessageId: opts.includeMessageId,
                files: (await selectedFiles).get(message.id),
              }),
            ];
          },
        },
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
    return this.handleRecord(record, false);
  }

  handleInternal(record: EventRecord): Promise<ChannelRuntimeResult> {
    return this.handleRecord(record, true);
  }

  beginDrain(): void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
    this.draining = true;
  }

  acquireDeliveryLease(): () => void {
    if (this.stopped) throw new Error("Channel runtime is stopped");
    return this.delivery.acquireDeliveryLease();
  }

  complete(turnId: string): Promise<void> {
    return this.delivery.complete(turnId);
  }

  deliverySignal(turnId: string): AbortSignal {
    return this.delivery.deliverySignal(turnId);
  }

  releaseDelivery(turnId: string): void {
    this.delivery.releaseDelivery(turnId);
  }

  drainAndStop(): Promise<void> {
    if (this.drainTask) return this.drainTask;
    this.beginDrain();
    this.drainTask = (async () => {
      await this.queue.run(async () => undefined);
      await this.delivery.waitForDeliveries();
      await this.agent.wait();
      await Promise.allSettled([...this.streams]);
      this.stopped = true;
      await this.agent.stop();
      await this.opts.will.stop?.();
      this.delivery.clear();
    })();
    return this.drainTask;
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.queue.run(async () => this.teardown("stop"));
    return this.stopTask;
  }

  private handleRecord(record: InputRecord, internal: boolean): Promise<ChannelRuntimeResult> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    if (this.draining && !internal) return Promise.reject(new ChannelRuntimeDrainingError());
    return this.queue.run(async () => {
      this.assertOpen();
      if (this.draining && !internal) throw new ChannelRuntimeDrainingError();
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
    this.delivery.clear();
  }

  private startRun(input: Input): ChannelRuntimeResult {
    const output = new OutputQueue<ChannelOutput>();
    const stream = this.agent.run(input);
    const turnId = this.agent.getActiveTurnId();
    if (turnId === null) throw new Error("Agent did not expose an active turn after run");
    this.delivery.openDelivery(turnId);
    const task = this.consumeStream(stream, output);
    this.streams.add(task);
    void task.finally(() => this.streams.delete(task));
    return { kind: "run", eventId: input.id, turnId, output };
  }

  private async consumeStream(
    stream: AsyncIterable<AgentInternalEvent>,
    output: OutputQueue<ChannelOutput>,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (isAssistantMessage(event)) {
          const segments = parseAssistantContent(event.message.content);
          if (segments !== undefined) output.push({ turnId: event.turnId, messageId: event.message.id, segments });
        }
        if (event.type === "turn.failed") {
          this.delivery.abortDelivery(event.turnId);
          throw new Error(event.error.message);
        }
        if (event.type === "turn.aborted") {
          this.delivery.abortDelivery(event.turnId);
          throw new Error("Agent turn aborted");
        }
      }
      output.close();
    } catch (cause) {
      output.close(cause);
    }
  }

  private readState(): WillEngine.State {
    return Object.freeze({ activeTurnId: this.agent.getActiveTurnId() });
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
  return event.type === "message.appended" && "turnId" in event && event.message.role === "assistant";
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
