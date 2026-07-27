import {
  type Awaitable,
  type Context,
  type Element,
  type Logger,
  type Session,
  Universal,
} from "koishi";

import type { ChannelScope } from "../channel/index.js";
import { resolveReplyPacingConfig, type PacingConfig } from "../config.js";
import { renderElements, sealElements, unavailableImage } from "../event/element.js";
import type {
  EventRecord,
  InputRecord,
  MessageRecord,
  ResolvedEventDraft,
  ResolvedMessageDraft,
} from "../event/index.js";
import { createImageFreezer, type AssetStore, type UnifiedImagePolicy } from "../media/index.js";
import { nextSegmentDelayMs } from "../reply/pacing.js";
import { assertAssignee, type RuntimeManager } from "../runtime/index.js";
import type { ChannelStorage } from "../storage/index.js";
import { matchesAllowedChannel, type ChannelAllowRule } from "./allowlist.js";

export interface ResolveContext {
  readonly session: Session;
  readonly freezeImage: (
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ) => Promise<Element>;
}

export interface SessionResolver {
  readonly platform: string;
  resolve(context: ResolveContext): Awaitable<ResolvedMessageDraft | ResolvedEventDraft | null>;
}

export interface GatewayOptions {
  readonly ctx: Context;
  readonly runtime: RuntimeManager;
  readonly assets: AssetStore;
  readonly storage: ChannelStorage;
  readonly allowedChannels: readonly ChannelAllowRule[];
  readonly logger: Logger;
  readonly mediaPolicy: UnifiedImagePolicy;
  readonly pacing?: PacingConfig;
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
    try {
      await assertAssignee(this.opts.ctx, scope);
    } catch (cause) {
      this.warn("gateway.assignee_rejected", cause, session.platform);
      return;
    }
    let record: InputRecord | null;
    try {
      record = await this.resolve(session, scope);
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
      const result = await this.opts.runtime.route(record);
      if (result.kind === "run") {
        try {
          let acknowledged = false;
          let consumedDeliveryMs = 0;
          let stopped = false;
          for await (const output of result.output) {
            for (const [index, segment] of output.segments.entries()) {
              if (result.delivery.signal.aborted) {
                stopped = true;
                break;
              }
              const delayMs = nextSegmentDelayMs({
                text: renderElements(segment),
                consumedDeliveryMs,
                config: this.pacing,
              });
              const delayStartedAt = Date.now();
              await waitForDelay(delayMs, result.delivery.signal);
              consumedDeliveryMs += Math.max(delayMs, this.elapsedSince(delayStartedAt));
              if (result.delivery.signal.aborted) {
                stopped = true;
                break;
              }
              try {
                await session.send(segment);
                if (!acknowledged) {
                  acknowledged = true;
                  await result.delivery.complete(output.turnId);
                }
              } catch (cause) {
                await this.failDelivery(
                  record,
                  {
                    turnId: output.turnId,
                    messageId: output.messageId,
                    segmentIndex: index + 1,
                    segmentTotal: output.segments.length,
                  },
                  cause,
                  result.delivery,
                );
                stopped = true;
                break;
              }
            }
            if (stopped) break;
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
      schemaVersion: 3,
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

  private async resolve(session: Session, scope: ChannelScope): Promise<InputRecord | null> {
    const resolver = this.resolvers.get(session.platform);
    if (!resolver) return resolveFallbackMessage(session, scope);
    const freezeImage = scope
      ? createImageFreezer({ scope, assets: this.opts.assets, policy: this.mediaPolicy })
          .freezeImage
      : async () => unavailableImage();
    const draft = await resolver.resolve({ session, freezeImage });
    return draft ? normalizeDraft(session, scope, draft) : null;
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

  private elapsedSince(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
  }
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

function resolveFallbackMessage(session: Session, scope: ChannelScope): MessageRecord | null {
  if (session.type !== "message-created") return null;

  if (!Array.isArray(session.elements)) return null;
  const elements = sealElements(session.elements);

  const messageId = session.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) return null;

  const timestamp =
    numberValue(session.timestamp) ?? numberValue(session.event.timestamp) ?? Date.now();

  return {
    schemaVersion: 3,
    platform: scope.platform,
    selfId: scope.selfId,
    channel: normalizeChannel(session, scope),
    user: normalizeUser(session),
    messageId,
    elements,
    timestamp,
  };
}

function normalizeDraft(
  session: Session,
  scope: ChannelScope,
  draft: ResolvedMessageDraft | ResolvedEventDraft,
): InputRecord {
  const timestamp =
    numberValue(session.timestamp) ?? numberValue(session.event.timestamp) ?? Date.now();
  const channel = normalizeChannel(
    session,
    scope,
    draft.kind === "message" ? draft.channel?.name : undefined,
  );
  if (draft.kind === "message") {
    const elements = sealElements(draft.elements);
    return {
      schemaVersion: 3,
      platform: scope.platform,
      selfId: scope.selfId,
      timestamp,
      channel,
      user: normalizeUser(session, draft.user),
      messageId: draft.messageId,
      elements,
    };
  }
  const { kind: _kind, eventType, text, ...variant } = draft;
  return {
    schemaVersion: 3,
    platform: scope.platform,
    selfId: scope.selfId,
    timestamp,
    channel,
    eventType,
    text,
    ...variant,
  } as EventRecord;
}

function normalizeChannel(
  session: Session,
  scope: ChannelScope,
  draftName?: string,
): Universal.Channel {
  const source = session.event.channel;
  const name = draftName ?? source?.name;
  return {
    id: scope.channelId,
    type:
      source?.type ??
      (scope.isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT),
    ...(name === undefined ? {} : { name }),
  };
}

function normalizeUser(session: Session, draft?: ResolvedMessageDraft["user"]): Universal.User {
  const source = session.event.user;
  const name = draft?.name ?? source?.name ?? session.author?.name;
  return {
    id: draft?.id ?? session.userId ?? source?.id ?? session.author?.id ?? "",
    ...(name === undefined ? {} : { name }),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(record: InputRecord): boolean {
  return Boolean(
    record.schemaVersion === 3 && record.platform && record.selfId && record.channel?.id,
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
