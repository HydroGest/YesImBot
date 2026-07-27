import { isAbsolute, resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import {
  createAgent,
  type Agent,
  type AgentInternalEvent,
  type AgentStorage,
  type AgentTool,
  type AgentToolSet,
  type ModelMessageContext,
  type TurnResult,
} from "@yesimbot/agent-runtime";
import type { FilePart, LanguageModel } from "ai";
import { Universal, type Awaitable, type Bot, type Context, type Element, type Logger } from "koishi";
import { z } from "zod";

import { channelIdentity, type ChannelScope } from "../channel/index.js";
import {
  resolveMultimediaImagePolicy,
  type Config,
} from "../config.js";
import { formatInput } from "../event/formatter.js";
import type { EventRecord, InputRecord } from "../event/index.js";
import { createInput, isInput, type Input } from "../event/index.js";
import type { AssetStore } from "../media/index.js";
import {
  selectInputFiles,
  UnsupportedImageMimeError,
  type UnifiedImagePolicy,
} from "../media/index.js";
import { resolveBasePath } from "../path.js";
import { parseReply } from "../reply/parse.js";
import type { ChannelStorage } from "../storage/index.js";
import { createWillEngine } from "../will/index.js";
import type { WillEngine, WillEngineObservation } from "../will/index.js";
import { buildCoreSystemPrompt } from "./prompt.js";
import { createJsonlStorage } from "./storage.js";

export interface RuntimeManagerOptions {
  readonly ctx: Context;
  readonly config: Config;
  readonly logger: Logger;
  readonly assets: Pick<AssetStore, "clear" | "readByAssetId">;
  readonly storage: ChannelStorage;
  readonly getAgentPluginFactories: () => readonly AgentPluginFactory[];
  readonly createChannelRuntime?: (options: ChannelRuntimeOptions) => ChannelRuntime;
}

export interface AgentPluginFactory {
  (context: { readonly channel: ChannelScope; readonly bot: Bot }): Awaitable<AgentPlugin | null>;
  readonly requiresMessageId?: boolean;
}

interface RuntimeEntry {
  readonly selfId: string;
  state: "active" | "reloading" | "failed";
  readonly runtime: ChannelRuntime;
}

type ChannelOutput = {
  readonly turnId: string;
  readonly messageId: string;
  readonly segments: readonly Element[][];
};

type ChannelRuntimeResult =
  | { readonly kind: "wait"; readonly eventId: string }
  | { readonly kind: "join"; readonly eventId: string; readonly turnId: string }
  | {
      readonly kind: "run";
      readonly eventId: string;
      readonly turnId: string;
      readonly output: AsyncIterable<ChannelOutput>;
    };

type RuntimeDelivery = {
  readonly fail: (record: EventRecord<"delivery.failed">) => Promise<ChannelRuntimeResult>;
  readonly complete: (turnId: string) => Promise<void>;
  readonly signal: AbortSignal;
  readonly release: () => void;
};

type RuntimeResult =
  | Exclude<ChannelRuntimeResult, { readonly kind: "run" }>
  | (Extract<ChannelRuntimeResult, { readonly kind: "run" }> & {
      readonly delivery: RuntimeDelivery;
    });

export class RuntimeReloadRequiredError extends Error {
  readonly name = "RuntimeReloadRequiredError";

  constructor(readonly scope: ChannelScope) {
    super(`Runtime reload is required for ${scope.platform}:${scope.channelId}`);
  }
}

export class RuntimeReloadInProgressError extends Error {
  readonly name = "RuntimeReloadInProgressError";

  constructor(readonly scope: ChannelScope) {
    super(`Runtime reload is in progress for ${scope.platform}:${scope.channelId}`);
  }
}

export class AssigneeAdmissionError extends Error {
  constructor(
    readonly reason: "missing" | "empty" | "mismatch",
    readonly scope: ChannelScope,
  ) {
    super(`Shared channel assignee admission failed: ${reason}`);
  }
}

export async function assertAssignee(ctx: Context, scope: ChannelScope): Promise<void> {
  if (scope.isDirect) return;
  const [channel] = await ctx.database.get(
    "channel",
    { platform: scope.platform, id: scope.channelId },
    ["assignee"],
  );
  if (!channel) throw new AssigneeAdmissionError("missing", scope);
  if (!channel.assignee) throw new AssigneeAdmissionError("empty", scope);
  if (channel.assignee !== scope.selfId) throw new AssigneeAdmissionError("mismatch", scope);
}

export class RuntimeManager {
  private runtimes = new Map<string, RuntimeEntry>();
  private tails = new Map<string, Promise<void>>();
  private reloads = new Map<string, Promise<void>>();
  private stopped = false;
  private stopTask: Promise<void> | undefined;

  constructor(private readonly opts: RuntimeManagerOptions) {}

  async route(record: InputRecord): Promise<RuntimeResult> {
    this.assertOpen();
    const scope = record.channel?.id
      ? {
          platform: record.platform,
          selfId: record.selfId,
          channelId: record.channel.id,
          isDirect: record.channel.type === Universal.Channel.Type.DIRECT,
        }
      : null;
    if (!scope) throw new Error("Accepted event requires a channel");
    const runtime = await this.getOrCreate(scope);
    this.assertOpen();
    let result: ChannelRuntimeResult;
    try {
      result = await runtime.handle(record);
    } catch (cause) {
      if (cause instanceof ChannelRuntimeDrainingError) {
        throw new RuntimeReloadInProgressError(scope);
      }
      throw cause;
    }
    if (result.kind !== "run") return result;
    const release = runtime.acquireDeliveryLease();
    return {
      ...result,
      delivery: {
        fail: (failure) => runtime.handleInternal(failure),
        complete: (turnId) => runtime.completeDelivery(turnId),
        signal: runtime.deliverySignal(result.turnId),
        release: () => {
          runtime.releaseDelivery(result.turnId);
          release();
        },
      },
    };
  }

  async reset(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const identity = channelIdentity(scope);
    const entry = await this.enqueueLifecycle(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      const current = this.runtimes.get(identity);
      if (!current) return undefined;
      if (current.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      current.state = "reloading";
      current.runtime.beginDrain();
      return current;
    });
    if (entry) await entry.runtime.drainAndStop();
    await this.enqueueLifecycle(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      try {
        await this.clearPersisted(scope);
      } finally {
        if (!entry || this.runtimes.get(identity) === entry) this.runtimes.delete(identity);
      }
    });
  }

  async reload(scope: ChannelScope): Promise<void> {
    this.assertOpen();
    const identity = channelIdentity(scope);
    const current = this.reloads.get(identity);
    if (current) return current;
    const task = this.reloadRuntime(identity, scope);
    this.reloads.set(identity, task);
    void task
      .finally(() => {
        if (this.reloads.get(identity) === task) this.reloads.delete(identity);
      })
      .catch(() => undefined);
    return task;
  }

  private async reloadRuntime(identity: string, scope: ChannelScope): Promise<void> {
    const entry = await this.enqueueLifecycle(identity, async () => {
      this.assertOpen();
      await this.assertCurrentAssignee(scope);
      const current = this.runtimes.get(identity);
      if (!current) return undefined;
      if (current.state === "failed") {
        throw new Error("Runtime reload failed; restart required");
      }
      if (current.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      current.state = "reloading";
      current.runtime.beginDrain();
      return current;
    });
    if (!entry) return;
    try {
      await entry.runtime.drainAndStop();
    } catch (cause) {
      await this.enqueueLifecycle(identity, async () => {
        if (this.runtimes.get(identity) === entry) entry.state = "failed";
      });
      throw cause;
    }
    await this.enqueueLifecycle(identity, async () => {
      if (this.runtimes.get(identity) === entry && entry.state === "reloading") {
        this.runtimes.delete(identity);
      }
    });
  }

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.stopInternal();
    return this.stopTask;
  }

  private async getOrCreate(scope: ChannelScope): Promise<ChannelRuntime> {
    const identity = channelIdentity(scope);
    const current = this.runtimes.get(identity);
    if (current?.state === "reloading") throw new RuntimeReloadInProgressError(scope);
    if (current?.state === "failed") throw new Error("Runtime reload failed; restart required");
    if (current && current.selfId !== scope.selfId) throw new RuntimeReloadRequiredError(scope);
    if (current?.state === "active") return current.runtime;

    return this.enqueueLifecycle(identity, async () => {
      this.assertOpen();
      const current = this.runtimes.get(identity);
      if (current?.state === "failed") throw new Error("Runtime reload failed; restart required");
      if (current?.state === "reloading") throw new RuntimeReloadInProgressError(scope);
      if (current && current.selfId !== scope.selfId) throw new RuntimeReloadRequiredError(scope);
      if (current) return current.runtime;
      const entry = await this.createRuntime(scope);
      try {
        this.assertOpen();
      } catch (cause) {
        await this.stopRuntime(identity, entry.runtime);
        throw cause;
      }
      this.runtimes.set(identity, entry);
      return entry.runtime;
    });
  }

  private async createRuntime(scope: ChannelScope): Promise<RuntimeEntry> {
    this.assertOpen();
    const bot = this.opts.ctx.bots.find(
      (candidate) => candidate.platform === scope.platform && candidate.selfId === scope.selfId,
    );
    if (!bot) throw new Error(`No Bot is available for ${scope.platform}:${scope.selfId}`);
    const resolved = this.opts.ctx["yesimbot.model"].resolveChatModel(this.opts.config.chatModel);
    const imageInput = resolved.entry.modalities?.input?.includes("image") === true;
    const mediaPolicy = resolveMultimediaImagePolicy(this.opts.config.multimedia);
    const factories = this.opts.getAgentPluginFactories();
    const plugins = (
      await Promise.all(factories.map((factory) => factory({ channel: scope, bot })))
    ).filter((plugin): plugin is AgentPlugin => plugin !== null);
    const includeMessageId = factories.some((factory) => factory.requiresMessageId === true);
    const will = createWillEngine(this.opts.config.will, {
      now: Date.now,
      random: Math.random,
      warn: (event, fields) => this.opts.logger.warn({ event, ...fields }),
    });
    const storagePath = await this.opts.storage.ensure(scope, "sessions", "messages.jsonl");
    const options: ChannelRuntimeOptions = {
      ctx: this.opts.ctx,
      config: {
        ...this.opts.config,
        basePath: resolveBasePath(this.opts.config.basePath, this.opts.ctx.baseDir),
      },
      logger: this.opts.logger,
      scope,
      bot,
      will,
      assets: this.opts.assets,
      model: resolved.model,
      provider: resolved.providerId,
      imageInput,
      mediaPolicy,
      agentPlugins: plugins,
      includeMessageId,
      storage: createJsonlStorage(storagePath),
    };
    const runtime = this.opts.createChannelRuntime?.(options) ?? new ChannelRuntime(options);
    try {
      await runtime.init();
    } catch (cause) {
      await runtime.stop().catch(() => undefined);
      throw cause;
    }
    return {
      selfId: scope.selfId,
      state: "active",
      runtime,
    };
  }

  private async stopInternal(): Promise<void> {
    await Promise.allSettled([...this.tails.values()]);
    const entries = [...this.runtimes.entries()];
    await Promise.all(
      entries.map(([identity, entry]) => this.stopRuntime(identity, entry.runtime)),
    );
    this.runtimes.clear();
    this.tails.clear();
    this.reloads.clear();
  }

  private async stopRuntime(identity: string, runtime: ChannelRuntime): Promise<void> {
    try {
      await runtime.stop();
    } catch (cause) {
      this.warn("runtime.stop_failed", { identity, cause });
    }
  }

  private async assertCurrentAssignee(scope: ChannelScope): Promise<void> {
    try {
      await assertAssignee(this.opts.ctx, scope);
    } catch (cause) {
      this.warn("runtime.assignee_rejected", { scope, cause });
      throw cause;
    }
  }

  private async clearPersisted(scope: ChannelScope): Promise<void> {
    let failure: unknown;
    try {
      const storagePath = await this.opts.storage.ensure(scope, "sessions", "messages.jsonl");
      await createJsonlStorage(storagePath).clear();
    } catch (cause) {
      failure = cause;
      this.warn("storage_clear_failed", { scope, cause });
    }
    try {
      await this.opts.assets.clear(scope);
    } catch (cause) {
      failure ??= cause;
      this.warn("asset_clear_failed", { scope, cause });
    }
    if (failure) throw failure;
  }

  private enqueueLifecycle<T>(identity: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(identity) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(identity, tail);
    void tail.finally(() => {
      if (this.tails.get(identity) === tail) this.tails.delete(identity);
    });
    return next;
  }

  private assertOpen(): void {
    if (this.stopped) throw new Error("Runtime manager is stopped");
  }

  private warn(event: string, fields: Record<string, unknown>): void {
    try {
      this.opts.logger.warn({ event, ...fields });
    } catch {}
  }
}

export namespace RuntimeManager {
  export type Delivery = RuntimeDelivery;
}

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

export class ChannelRuntimeDrainingError extends Error {
  constructor() {
    super("Channel runtime is draining");
    this.name = "ChannelRuntimeDrainingError";
  }
}

class OutputQueue implements AsyncIterable<ChannelOutput> {
  private items: ChannelOutput[] = [];
  private pendingNext:
    | {
        resolve: (result: IteratorResult<ChannelOutput>) => void;
        reject: (cause: unknown) => void;
      }
    | undefined;
  private error: unknown;
  private done = false;

  push(item: ChannelOutput): void {
    if (this.done) return;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (pendingNext) pendingNext.resolve({ done: false, value: item });
    else this.items.push(item);
  }

  close(error?: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    const pendingNext = this.pendingNext;
    this.pendingNext = undefined;
    if (pendingNext) {
      if (error) pendingNext.reject(error);
      else pendingNext.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ChannelOutput> {
    return {
      next: async () => {
        const item = this.items.shift();
        if (item !== undefined) return { done: false, value: item };
        if (this.error) throw this.error;
        if (this.done) return { done: true, value: undefined };
        return await new Promise<IteratorResult<ChannelOutput>>((resolve, reject) => {
          this.pendingNext = { resolve, reject };
        });
      },
    };
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isAssistantMessage(event: AgentInternalEvent): event is AgentInternalEvent & {
  type: "message.appended";
  turnId: string;
  message: { id: string; role: "assistant"; content: unknown };
} {
  return (
    event.type === "message.appended" && "turnId" in event && event.message.role === "assistant"
  );
}

function renderAssistantText(content: unknown): string | undefined {
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

function parseAssistantContent(content: unknown): Element[][] | undefined {
  const text = renderAssistantText(content);
  if (text === undefined) return undefined;
  return parseReply(text);
}

function hasRenderableSegment(content: unknown): boolean {
  return (
    parseAssistantContent(content)?.some((segment) =>
      segment.some((element) => element.type === "text" && `${element.attrs["content"] ?? ""}`.trim().length > 0),
    ) === true
  );
}

type ReplyEligibility = "pending" | "eligible" | "ineligible";

type ReplyCompletion = {
  acknowledged: boolean;
  deliveryReleased: boolean;
  eligibility: ReplyEligibility;
};

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
  private readonly agent: Agent;
  private replyCompletions = new Map<string, ReplyCompletion>();
  private deliveryAborts = new Map<string, AbortController>();
  private replyCompletionTail = Promise.resolve();
  private initTask: Promise<void> | undefined;

  constructor(private readonly opts: ChannelRuntimeOptions) {
    this.scope = Object.freeze({ ...opts.scope });
    const plugins = opts.agentPlugins;
    const includeMessageId = opts.includeMessageId;
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
    };
    const tools: AgentToolSet = [sendMessageTool];

    this.agent = createAgent({
      id: channelIdentity(this.scope),
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
            const formatted = formatInput(message, {
              includeMessageId,
              files: (await selectedFiles).get(message.id),
            });
            return [formatted];
          },
        },
        {
          name: "core.will-reply",
          enforce: "pre",
          onTurnFinish: async (result) => this.recordReplyCompletion(result),
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

  completeDelivery(turnId: string): Promise<void> {
    return this.enqueueReplyCompletion(async () => {
      const completion = this.replyCompletions.get(turnId);
      if (!completion) return;
      completion.acknowledged = true;
      await this.reconcileReplyCompletion(turnId, completion);
    });
  }

  deliverySignal(turnId: string): AbortSignal {
    const controller = this.deliveryAborts.get(turnId);
    if (!controller) throw new Error(`Delivery signal is unavailable for turn ${turnId}`);
    return controller.signal;
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
      this.replyCompletions.clear();
    })();
    return this.drainTask;
  }

  private handleRecord(record: InputRecord, internal: boolean): Promise<ChannelRuntimeResult> {
    if (this.stopped) return Promise.reject(new Error("Channel runtime is stopped"));
    if (this.draining && !internal) return Promise.reject(new ChannelRuntimeDrainingError());
    return this.enqueue(async () => {
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

  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopped = true;
    this.stopTask = this.enqueue(async () => {
      await this.teardown("stop");
    });
    return this.stopTask;
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
    this.replyCompletions.clear();
  }

  private waitForDeliveries(): Promise<void> {
    if (this.deliveryLeases === 0) return Promise.resolve();
    return new Promise((resolve) => this.deliveryWaiters.add(resolve));
  }

  private startRun(input: Input): ChannelRuntimeResult {
    const output = new OutputQueue();
    const stream = this.agent.run(input);
    const turnId = this.agent.getActiveTurnId();
    if (turnId === null) {
      throw new Error("Agent did not expose an active turn after run");
    }
    this.replyCompletions.set(turnId, {
      acknowledged: false,
      deliveryReleased: false,
      eligibility: "pending",
    });
    this.deliveryAborts.set(turnId, new AbortController());
    const task = this.consumeStream(stream, output);
    this.streams.add(task);
    void task.finally(() => this.streams.delete(task));
    return { kind: "run", eventId: input.id, turnId, output };
  }

  private async consumeStream(
    stream: AsyncIterable<AgentInternalEvent>,
    output: OutputQueue,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (isAssistantMessage(event)) {
          const segments = parseAssistantContent(event.message.content);
          if (segments !== undefined) {
            output.push({
              turnId: event.turnId,
              messageId: event.message.id,
              segments,
            });
          }
        }
        if (event.type === "turn.failed") {
          this.abortDelivery(event.turnId);
          throw new Error(event.error.message);
        }
        if (event.type === "turn.aborted") {
          this.abortDelivery(event.turnId);
          throw new Error("Agent turn aborted");
        }
      }
      output.close();
    } catch (cause) {
      output.close(cause);
    }
  }

  releaseDelivery(turnId: string): void {
    void this.enqueueReplyCompletion(async () => {
      const completion = this.replyCompletions.get(turnId);
      if (!completion) return;
      completion.deliveryReleased = true;
      this.deliveryAborts.delete(turnId);
      await this.reconcileReplyCompletion(turnId, completion);
    });
  }

  private recordReplyCompletion(result: TurnResult): Promise<void> {
    return this.enqueueReplyCompletion(async () => {
      if (result.status === "failed" || result.status === "aborted")
        this.abortDelivery(result.turnId);
      const completion = this.replyCompletions.get(result.turnId);
      if (!completion) return;
      completion.eligibility =
        result.status === "done" &&
        result.messages.some(
          (message) =>
            message.role === "assistant" && hasRenderableSegment(message.content),
        )
          ? "eligible"
          : "ineligible";
      await this.reconcileReplyCompletion(result.turnId, completion);
    });
  }

  private async reconcileReplyCompletion(
    turnId: string,
    completion: ReplyCompletion,
  ): Promise<void> {
    if (completion.eligibility === "ineligible") {
      this.replyCompletions.delete(turnId);
      return;
    }
    if (completion.eligibility === "pending") return;
    if (!completion.acknowledged) {
      if (completion.deliveryReleased) this.replyCompletions.delete(turnId);
      return;
    }
    this.replyCompletions.delete(turnId);
    try {
      await this.opts.will.onReply?.();
    } catch (cause) {
      this.warn("will_reply_failed", { cause });
    }
  }

  private enqueueReplyCompletion(operation: () => Promise<void>): Promise<void> {
    const next = this.replyCompletionTail.then(operation, operation);
    this.replyCompletionTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private abortDelivery(turnId: string): void {
    this.deliveryAborts.get(turnId)?.abort();
  }

  private readState(): WillEngine.State {
    return Object.freeze({
      activeTurnId: this.agent.getActiveTurnId(),
    });
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
