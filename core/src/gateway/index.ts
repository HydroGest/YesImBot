import { type Context, type Element, type Logger, type Session, Universal } from "koishi";

import { deliverOutput } from "../delivery.js";
import { ChannelScope } from "../index.js";
import type { EventRecord, MessageRecord, RecordBase } from "../messages.js";
import type { ChannelRuntimeResult } from "../runtime/index.js";
import { createDefaultTranslator } from "./default.js";
import type { ChannelAllowRule, GatewayConfig, GatewayOptions, PlatformTranslator } from "./types.js";

export class Gateway {
  private readonly ctx: Context;
  private readonly config: GatewayConfig;
  private readonly logger: Logger;

  private readonly opts: GatewayOptions;

  private translators = new Map<string, PlatformTranslator>();
  private readonly fallback: PlatformTranslator;
  private sessions = new WeakSet<object>();
  private tasks = new Set<Promise<void>>();
  private disposers: Array<() => unknown> = [];
  private closed = false;

  constructor(ctx: Context, config: GatewayConfig, opts: GatewayOptions) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.gateway");
    this.logger.level = config.logLevel ?? 2;
    this.fallback = createDefaultTranslator(ctx);

    this.opts = opts;

    const middleware = this.ctx.middleware(async (session, next) => {
      try {
        await this.handle(session);
      } finally {
        await next();
      }
    });
    if (typeof middleware === "function") this.disposers.push(middleware as () => unknown);
    const internal = this.ctx.on("internal/session", (session) => {
      if (!isMessageSession(session)) void this.handle(session);
    });
    if (typeof internal === "function") this.disposers.push(internal as () => unknown);
  }

  public registerTranslator(translator: PlatformTranslator): () => void {
    if (this.translators.has(translator.platform)) {
      throw new Error(`Translator for platform "${translator.platform}" is already registered`);
    }
    this.translators.set(translator.platform, translator);
    return () => {
      if (this.translators.get(translator.platform) === translator) this.translators.delete(translator.platform);
    };
  }

  public async handle(session: Session): Promise<void> {
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

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
  }

  public async drain(): Promise<void> {
    await Promise.allSettled([...this.tasks]);
  }

  private async route(session: Session): Promise<void> {
    const scope = scopeFromSession(session);
    if (!scope || !matchesAllowedChannel(scope, this.config.allowedChannels)) return;
    try {
      await this.opts.ready();
      await assertAssignee(this.ctx, scope);
      const translator = this.translators.get(session.platform) ?? this.translators.get("*") ?? this.fallback;
      const base = sessionBase(session, scope);
      const record = await translator.translate(base, session, this.opts.assets.createStore(scope));
      if (!record) return;
      const result = await this.opts.runtime.route(record, session);
      if (result.kind === "run") await this.deliver(session, record, result);
    } catch (cause) {
      this.warn("gateway.route_failed", cause, session.platform);
    }
  }

  private async deliver(
    session: Session,
    record: MessageRecord | EventRecord,
    result: Extract<ChannelRuntimeResult, { readonly kind: "run" }>,
  ): Promise<void> {
    await deliverOutput({
      record,
      result,
      pacing: this.config.pacing,
      send: async (segment) => {
        this.logger.debug("send", {
          platform: record.platform,
          selfId: record.selfId,
          channelId: record.channel.id,
          segment: formatDebugSegment(segment),
        });
        const sent = await session.send(segment);
        this.logger.debug("send_result", {
          platform: record.platform,
          selfId: record.selfId,
          channelId: record.channel.id,
          result: formatDebugValue(sent),
        });
        return sent;
      },
      warn: (cause) => this.warn("delivery.failed", cause, record.platform),
    });
  }

  private warn(code: string, cause: unknown, platform: string): void {
    try {
      this.logger.warn({
        code,
        platform,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {}
  }
}

class AssigneeAdmissionError extends Error {
  constructor(
    readonly reason: "missing" | "empty" | "mismatch",
    readonly scope: ChannelScope,
  ) {
    super(`Shared channel assignee admission failed: ${reason}`);
  }
}

export function matchesAllowedChannel(scope: ChannelScope, rules: readonly ChannelAllowRule[] | undefined): boolean {
  return (
    rules?.some(
      (rule) =>
        (rule.platform === "*" || rule.platform === scope.platform) &&
        (rule.channelId === "*" || rule.channelId === scope.channelId) &&
        (rule.isDirect === undefined || rule.isDirect === (scope.type === "direct")),
    ) ?? false
  );
}

async function assertAssignee(ctx: Context, scope: ChannelScope): Promise<void> {
  if (scope.type === "direct") return;
  const [channel] = await ctx.database.get("channel", { platform: scope.platform, id: scope.channelId }, ["assignee"]);
  if (!channel) throw new AssigneeAdmissionError("missing", scope);
  if (!channel.assignee) throw new AssigneeAdmissionError("empty", scope);
  if (channel.assignee !== scope.selfId) throw new AssigneeAdmissionError("mismatch", scope);
}

function sessionBase(session: Session, scope: ChannelScope): RecordBase {
  return {
    platform: scope.platform,
    selfId: scope.selfId,
    timestamp: session.timestamp,
    channel: {
      id: scope.channelId,
      type:
        session.event.channel?.type ??
        (scope.type === "direct" ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT),
      ...(session.event.channel?.name === undefined ? {} : { name: session.event.channel.name }),
    },
    user: {
      id: session.userId || session.event.user?.id || session.author?.id || "",
      ...((session.event.user?.name ?? session.author?.name) === undefined
        ? {}
        : { name: session.event.user?.name ?? session.author?.name }),
    },
  };
}

function scopeFromSession(session: Session): ChannelScope | null {
  if (!session.platform || !session.selfId || !session.channelId) return null;
  return {
    type: session.isDirect ? "direct" : "shared",
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
  };
}

function isMessageSession(session: Session): boolean {
  return session.type === "message-created";
}

function formatDebugSegment(segment: readonly Element[]): string {
  const text = segment
    .filter((element) => element.type === "text")
    .map((element) => `${element.attrs["content"] ?? ""}`)
    .join("");
  const types = [...new Set(segment.map((element) => element.type))].join("+");
  return text.length > 0 ? `${types}: ${truncate(text)}` : types;
}

function formatDebugValue(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : truncate(text);
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  return value.length > 2048 ? `${value.slice(0, 2048)}...` : value;
}

export type { ChannelAllowRule, GatewayConfig, GatewayOptions, PlatformTranslator } from "./types.js";
export { createDefaultTranslator } from "./default.js";
