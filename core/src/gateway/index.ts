import { Context, h, Logger, type Awaitable, type Element, type Session, Universal } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { EventRecord } from "../event/index.js";
import type { RuntimeManager } from "../runtime/manager.js";
import type { AssetStore } from "../shared/asset.js";
import { normalizeElements, sealElements, unavailableImage } from "../shared/element.js";
import { createImageFreezer } from "./image.js";

export interface ResolveContext {
  readonly session: Session;
  readonly base?: Omit<EventRecord<"message">, "content">;
  readonly freezeImage: (
    element: Element,
    load: (signal: AbortSignal, maxBytes: number) => Promise<{ data: Uint8Array; mime?: string }>,
  ) => Promise<Element>;
}

export interface SessionResolver {
  readonly platform: string;
  resolve(context: ResolveContext): Awaitable<EventRecord | null>;
}

export interface GatewayOptions {
  readonly ctx: Context;
  readonly runtime: RuntimeManager;
  readonly assets: AssetStore;
  readonly logger: Logger;
}

export class Gateway {
  private resolvers = new Map<string, SessionResolver>();
  private sessions = new WeakSet<object>();
  private tasks = new Set<Promise<void>>();
  private disposers: Array<() => unknown> = [];
  private closed = false;

  constructor(private readonly opts: GatewayOptions) {
    const middleware = opts.ctx.middleware(async (session, next) => {
      try {
        await this.handle(session);
      } finally {
        await next();
      }
    }, true);
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
    let record: EventRecord | null;
    try {
      record = await this.resolve(session);
    } catch (cause) {
      this.warn("gateway.resolver_failed", cause, session.platform);
      return;
    }
    if (!record) return;
    const scope = scopeFromSession(session);
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
      const result = await this.opts.runtime.route(record);
      if (result.kind === "run") {
        for await (const output of result.output) {
          try {
            await session.send(output.content);
          } catch (cause) {
            await this.failDelivery(record, output, cause);
          }
        }
      }
    } catch (cause) {
      this.warn("gateway.route_failed", cause, session.platform);
    }
  }

  private async failDelivery(
    record: EventRecord,
    output: { readonly turnId: string; readonly messageId: string },
    cause: unknown,
  ): Promise<void> {
    const error = normalizeDeliveryError(cause);
    const failure = {
      type: "delivery.failed",
      platform: record.platform,
      selfId: record.selfId,
      timestamp: Date.now(),
      channel: record.channel,
      delivery: { turnId: output.turnId, messageId: output.messageId, error },
      content: `Delivery of assistant message ${output.messageId} failed: ${error.message}`,
    } as EventRecord<"delivery.failed">;
    try {
      await this.opts.runtime.route(failure);
    } catch (feedbackCause) {
      this.warn("delivery.failed", feedbackCause, record.platform);
    }
  }

  private async resolve(session: Session): Promise<EventRecord | null> {
    const base = draftMessageEventBase(session);
    const resolver = this.resolvers.get(session.platform);
    if (!resolver) return base ? resolveFallbackMessage(base) : null;
    const scope = scopeFromSession(session);
    const freezeImage = scope
      ? createImageFreezer({ scope, assets: this.opts.assets }).freezeImage
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

function draftMessageEventBase(session: Session): Omit<EventRecord<"message">, "content"> | null {
  const scope = scopeFromSession(session);
  if (!scope || !isMessageSession(session)) return null;
  const elements = normalizeElements(h.normalize(session.elements ?? session.content ?? ""));
  const event = objectValue(session.event);
  const { type: _type, content: _content, ...resources } = event;
  const channel = objectValue(resources.channel);
  const user = objectValue(resources.user);
  const message = objectValue(resources.message);
  const timestamp =
    numberValue(session.timestamp) ?? numberValue(resources.timestamp) ?? Date.now();
  return {
    ...resources,
    type: "message",
    platform: scope.platform,
    selfId: scope.selfId,
    timestamp,
    channel: { ...channel, id: scope.channelId, type: channel.type ?? 0 },
    user: {
      ...user,
      id: stringValue(user.id) ?? session.userId ?? session.author?.id ?? "",
      ...(user.name === undefined && session.author?.name ? { name: session.author.name } : {}),
    },
    message: {
      ...message,
      id: stringValue(message.id) ?? String(session.messageId ?? ""),
      content: elements.map((element) => element.toString()).join(""),
      elements,
    },
  } as Omit<EventRecord<"message">, "content">;
}

function resolveFallbackMessage(
  base: Omit<EventRecord<"message">, "content">,
): EventRecord<"message"> {
  const elements = (base.message as { elements?: readonly Element[] }).elements ?? [];
  return {
    ...base,
    content: sealElements(elements)
      .map((element) => element.toString())
      .join(""),
  };
}

function isRecord(record: EventRecord): boolean {
  return Boolean(record.type && record.platform && record.selfId && record.channel?.id);
}

function hasScope(record: EventRecord, scope: ChannelScope): boolean {
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

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeDeliveryError(cause: unknown): { name: string; message: string; code?: string } {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code =
    typeof (cause as { code?: unknown } | null)?.code === "string"
      ? (cause as { code: string }).code
      : undefined;
  return { name: error.name, message: error.message, ...(code === undefined ? {} : { code }) };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
