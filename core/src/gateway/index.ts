import {
  type Awaitable,
  type Context,
  type Element,
  type Fragment,
  type Logger,
  type Session,
  Universal,
} from "koishi";

import type { ChannelScope } from "../channel/index.js";
import { resolveReplyPacingConfig, type PacingConfig } from "../config.js";
import { normalizeElements, sealElements, unavailableImage } from "../event/element.js";
import type { EventRecord, InputRecord, MessageRecord } from "../event/index.js";
import { createImageFreezer, type AssetStore, type UnifiedImagePolicy } from "../media/index.js";
import type { ReplyDeliveryStatus, ReplyObservation } from "../reply/observability.js";
import { nextSegmentDelayMs } from "../reply/pacing.js";
import { assertAssignee, type RuntimeManager } from "../runtime/index.js";
import type { ChannelStorage } from "../storage/index.js";
import { matchesAllowedChannel, type ChannelAllowRule } from "./allowlist.js";

export interface ResolveContext {
  readonly session: Session;
  readonly base?: Omit<MessageRecord, "text">;
  readonly freezeImage: (
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ) => Promise<Element>;
}

export interface SessionResolver {
  readonly platform: string;
  resolve(context: ResolveContext): Awaitable<InputRecord | null>;
}

export interface GatewayOptions {
  readonly ctx: Context;
  readonly runtime: RuntimeManager;
  readonly assets: AssetStore;
  readonly storage: ChannelStorage;
  readonly allowedChannels: readonly ChannelAllowRule[];
  readonly ready: () => Promise<void>;
  readonly logger: Logger;
  readonly mediaPolicy: UnifiedImagePolicy;
  readonly pacing?: PacingConfig;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export class Gateway {
  private mediaPolicy: UnifiedImagePolicy;
  private readonly pacing: PacingConfig;
  private resolvers = new Map<string, SessionResolver>();
  private sessions = new WeakSet<object>();
  private tasks = new Set<Promise<void>>();
  private disposers: Array<() => unknown> = [];
  private closed = false;

  constructor(private readonly opts: GatewayOptions) {
    this.mediaPolicy = opts.mediaPolicy;
    this.pacing = resolveReplyPacingConfig(opts.pacing);
    const middleware = opts.ctx.middleware(async (session, next) => {
      try {
        await new Promise((resolve, _reject) => {
          setImmediate(() => {
            resolve(0);
          });
        });
        await this.handle(session);
      } finally {
        await next();
      }
    });
    if (typeof middleware === "function") this.disposers.push(middleware as () => unknown);

    const internal = opts.ctx.on("internal/session", (session) => {
      if (!isMessageSession(session)) void this.handle(session);
    });
    if (typeof internal === "function") this.disposers.push(internal as () => unknown);
  }

  register(resolver: SessionResolver): () => void {
    if (this.resolvers.has(resolver.platform)) {
      throw new Error(`Resolver for platform "${resolver.platform}" is already registered`);
    }
    this.resolvers.set(resolver.platform, resolver);
    return () => {
      if (this.resolvers.get(resolver.platform) === resolver) {
        this.resolvers.delete(resolver.platform);
      }
    };
  }

  refreshMediaPolicy(policy: UnifiedImagePolicy): void {
    this.mediaPolicy = policy;
  }

  async handle(session: Session): Promise<void> {
    if (this.closed || this.sessions.has(session)) return;
    this.sessions.add(session);
    const task = this.route(session);
    this.tasks.add(task);
    try {
      await task;
    } finally {
      this.tasks.delete(task);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.tasks]);
  }

  private async route(session: Session): Promise<void> {
    const scope = scopeFromSession(session);
    if (!scope) return;
    if (!matchesAllowedChannel(scope, this.opts.allowedChannels)) return;
    await this.opts.ready();
    try {
      await assertAssignee(this.opts.ctx, scope);
    } catch (cause) {
      this.warn("gateway.assignee_rejected", cause, session.platform);
      return;
    }
    let record: InputRecord | null;
    try {
      record = await this.resolve(session);
    } catch (cause) {
      this.warn("gateway.resolver_failed", cause, session.platform);
      return;
    }
    if (!record) return;
    if (
      !isRecord(record) ||
      !scope ||
      !hasScope(record, scope) ||
      containsReference(record, session)
    ) {
      this.warn(
        "gateway.invalid_record",
        new Error("Resolved record is invalid or retains its Session"),
        session.platform,
      );
      return;
    }
    try {
      await this.opts.storage.updateName(scope, record.channel.name);
      const routeStartedAt = this.now();
      const result = await this.opts.runtime.route(record);
      if (result.kind === "run") {
        try {
          let acknowledged = false;
          let consumedDeliveryMs = 0;
          const pending = new Map<
            string,
            { readonly output: GatewayOutput; readonly startedAt: number }
          >();
          try {
            for await (const output of result.output) {
              const gatewayOutput = output;
              if (!pending.has(gatewayOutput.messageId)) {
                pending.set(gatewayOutput.messageId, {
                  output: gatewayOutput,
                  startedAt: this.now(),
                });
              }
              if (result.delivery.signal.aborted) {
                this.settleObservation(
                  result.delivery,
                  pending,
                  gatewayOutput.messageId,
                  "cancelled",
                );
                break;
              }
              const delayMs = nextSegmentDelayMs({
                segment: {
                  text: gatewayOutput.content.toString(),
                  index: gatewayOutput.segmentIndex,
                  total: gatewayOutput.segmentTotal,
                  sleepHintMs: gatewayOutput.sleepHintMs,
                },
                config: this.pacing,
                elapsedGenerationMs: this.elapsedSince(routeStartedAt),
                consumedDeliveryMs,
                random: this.opts.random ?? Math.random,
              });
              const delayStartedAt = this.now();
              await (this.opts.wait ?? waitForDelay)(delayMs, result.delivery.signal);
              consumedDeliveryMs += Math.max(delayMs, this.elapsedSince(delayStartedAt));
              if (result.delivery.signal.aborted) {
                this.settleObservation(
                  result.delivery,
                  pending,
                  gatewayOutput.messageId,
                  "cancelled",
                );
                break;
              }
              try {
                await session.send(gatewayOutput.content);
                if (!acknowledged) {
                  acknowledged = true;
                  await result.delivery.complete(gatewayOutput.turnId);
                }
                if (gatewayOutput.segmentIndex === gatewayOutput.segmentTotal) {
                  this.settleObservation(
                    result.delivery,
                    pending,
                    gatewayOutput.messageId,
                    "delivered",
                  );
                }
              } catch (cause) {
                this.settleObservation(result.delivery, pending, gatewayOutput.messageId, "failed");
                await this.failDelivery(record, gatewayOutput, cause, result.delivery);
                break;
              }
            }
          } finally {
            for (const messageId of pending.keys()) {
              this.settleObservation(result.delivery, pending, messageId, "incomplete");
            }
          }
        } finally {
          result.delivery.release();
        }
      }
    } catch (cause) {
      this.warn("gateway.route_failed", cause, session.platform);
    }
  }

  private async failDelivery(
    record: InputRecord,
    output: {
      readonly turnId: string;
      readonly messageId: string;
      readonly segmentIndex: number;
      readonly segmentTotal: number;
    },
    cause: unknown,
    delivery: RuntimeManager.Delivery,
  ): Promise<void> {
    const error = normalizeDeliveryError(cause);
    const failure: EventRecord<"delivery.failed"> = {
      sn: record.sn,
      login: record.login,
      referrer: record.referrer,
      schemaVersion: 1,
      eventType: "delivery.failed",
      platform: record.platform,
      selfId: record.selfId,
      timestamp: Date.now(),
      channel: record.channel,
      delivery: {
        turnId: output.turnId,
        messageId: output.messageId,
        segmentIndex: output.segmentIndex,
        segmentTotal: output.segmentTotal,
        error,
      },
      text: `Delivery of assistant message ${output.messageId} failed: ${error.message}`,
    };
    try {
      await delivery.fail(failure);
    } catch (feedbackCause) {
      this.warn("delivery.failed", feedbackCause, record.platform);
    }
  }

  private settleObservation(
    delivery: RuntimeManager.Delivery,
    pending: Map<string, { readonly output: GatewayOutput; readonly startedAt: number }>,
    messageId: string,
    deliveryStatus: ReplyDeliveryStatus,
  ): void {
    const pendingReply = pending.get(messageId);
    if (!pendingReply) return;
    pending.delete(messageId);
    const { output, startedAt } = pendingReply;
    const observation: ReplyObservation = {
      provider: output.provider,
      segmentCount: output.segmentTotal,
      segmentLengths: output.segmentLengths,
      controlAdopted: output.controlAdopted,
      skipped: false,
      totalDeliveryMs: this.elapsedSince(startedAt),
      deliveryStatus,
      ...(output.degradationReason === undefined
        ? {}
        : { degradationReason: output.degradationReason }),
    };
    delivery.observe(observation);
  }

  private async resolve(session: Session): Promise<InputRecord | null> {
    const base = draftMessageBase(session);
    const resolver = this.resolvers.get(session.platform);
    if (!resolver) return base ? resolveFallbackMessage(base) : null;
    const scope = scopeFromSession(session);
    const freezeImage = scope
      ? createImageFreezer({ scope, assets: this.opts.assets, policy: this.mediaPolicy })
          .freezeImage
      : async () => unavailableImage();
    return resolver.resolve({ session, ...(base ? { base } : {}), freezeImage });
  }

  private warn(code: string, cause: unknown, platform: string): void {
    try {
      this.opts.logger.warn({
        code,
        platform,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {}
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private elapsedSince(startedAt: number): number {
    return Math.max(0, this.now() - startedAt);
  }
}

interface GatewayOutput {
  readonly turnId: string;
  readonly messageId: string;
  readonly content: Fragment;
  readonly segmentIndex: number;
  readonly segmentTotal: number;
  readonly sleepHintMs: number;
  readonly provider: string;
  readonly controlAdopted: boolean;
  readonly segmentLengths: readonly number[];
  readonly degradationReason?: ReplyObservation["degradationReason"];
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isMessageSession(session: Session): boolean {
  return session.type === "message-created";
}

function scopeFromSession(session: Session): ChannelScope | null {
  if (!session.platform || !session.selfId || !session.channelId) return null;
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    isDirect: session.isDirect,
  };
}

function draftMessageBase(session: Session): Omit<MessageRecord, "text"> | null {
  const scope = scopeFromSession(session);
  if (!scope || session.type !== "message-created") return null;

  const elements = session.elements;
  if (!Array.isArray(elements)) return null;

  const messageId = session.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) return null;

  const {
    type: _type,
    timestamp: eventTimestamp,
    message: _message,
    channel,
    user,
    ...resources
  } = session.event;
  const timestamp = numberValue(session.timestamp) ?? numberValue(eventTimestamp) ?? Date.now();

  return {
    ...resources,
    schemaVersion: 1,
    platform: scope.platform,
    selfId: scope.selfId,
    channel: {
      ...channel,
      id: scope.channelId,
      type: channel?.type ?? Universal.Channel.Type.TEXT,
    },
    user: {
      ...user,
      id: user?.id ?? session.userId ?? session.author?.id ?? "",
      ...(user?.name === undefined && session.author?.name ? { name: session.author.name } : {}),
    },
    messageId,
    elements,
    timestamp,
  } satisfies Omit<MessageRecord, "text">;
}

function resolveFallbackMessage(base: Omit<MessageRecord, "text">): MessageRecord {
  const sealedElements = sealElements(normalizeElements([...base.elements]));
  return {
    ...base,
    text: sealedElements.map((element) => element.toString()).join(""),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(record: InputRecord): boolean {
  return Boolean(
    record.schemaVersion === 1 && record.platform && record.selfId && record.channel?.id,
  );
}

function hasScope(record: InputRecord, scope: ChannelScope): boolean {
  return (
    record.platform === scope.platform &&
    record.selfId === scope.selfId &&
    record.channel.id === scope.channelId &&
    (record.channel.type === Universal.Channel.Type.DIRECT) === scope.isDirect
  );
}

function containsReference(value: unknown, target: object, seen = new WeakSet<object>()): boolean {
  if (value === target) return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  try {
    return Object.values(value).some((child) => containsReference(child, target, seen));
  } catch {
    return true;
  }
}

function normalizeDeliveryError(cause: unknown): { name: string; message: string; code?: string } {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code =
    typeof (cause as { code?: unknown } | null)?.code === "string"
      ? (cause as { code: string }).code
      : undefined;
  return { name: error.name, message: error.message, ...(code === undefined ? {} : { code }) };
}
