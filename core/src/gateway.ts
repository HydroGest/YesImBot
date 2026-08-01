import { type Awaitable, type Context, type Logger, type Session, Universal } from "koishi";

import type { AssetService, AssetStore } from "./asset.js";
import type { ChannelScope } from "./channel.js";
import { type PacingConfig } from "./config.js";
import { deliverOutput } from "./delivery.js";
import type { EventRecord, MessageRecord, RecordBase } from "./messages.js";
import type { ChannelRuntimeResult, RuntimeManager } from "./runtime/index.js";

export interface ChannelAllowRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export interface PlatformTranslator {
  readonly platform: string;
  translate(
    base: RecordBase,
    session: Session,
    store: AssetStore,
  ): Awaitable<MessageRecord | EventRecord | null>;
}

class AssigneeAdmissionError extends Error {
  constructor(
    readonly reason: "missing" | "empty" | "mismatch",
    readonly scope: ChannelScope,
  ) {
    super(`Shared channel assignee admission failed: ${reason}`);
  }
}

export interface GatewayOptions {
  readonly runtime: RuntimeManager;
  readonly assets: AssetService;
  readonly ready: () => Promise<void>;
}

export interface GatewayConfig {
  allowedChannels: readonly ChannelAllowRule[];
  pacing: PacingConfig;
  logLevel: number;
}

export class Gateway {
  private readonly ctx: Context;
  private readonly config: GatewayConfig;
  private readonly logger: Logger;

  private readonly opts: GatewayOptions;

  private translators = new Map<string, PlatformTranslator>();
  private sessions = new WeakSet<object>();
  private tasks = new Set<Promise<void>>();
  private disposers: Array<() => unknown> = [];
  private closed = false;

  constructor(ctx: Context, config: GatewayConfig, opts: GatewayOptions) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.gateway");
    this.logger.level = config.logLevel ?? 2;

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

  registerTranslator(translator: PlatformTranslator): () => void {
    if (this.translators.has(translator.platform)) {
      throw new Error(`Translator for platform "${translator.platform}" is already registered`);
    }
    this.translators.set(translator.platform, translator);
    return () => {
      if (this.translators.get(translator.platform) === translator)
        this.translators.delete(translator.platform);
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
    const scope = scopeFromSession(session);
    if (!scope || !matchesAllowedChannel(scope, this.config.allowedChannels)) return;
    try {
      await this.opts.ready();
      await assertAssignee(this.ctx, scope);
      const translator =
        this.translators.get(session.platform) ?? this.translators.get("*") ?? defaultTranslator;
      const base = sessionBase(session, scope);
      const record = await translator.translate(base, session, this.opts.assets.createStore(scope));
      if (!record) return;
      const result = await this.opts.runtime.route(record);
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
      send: (segment) => session.send(segment),
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

async function assertAssignee(ctx: Context, scope: ChannelScope): Promise<void> {
  if (scope.type === "direct") return;
  const [channel] = await ctx.database.get(
    "channel",
    { platform: scope.platform, id: scope.channelId },
    ["assignee"],
  );
  if (!channel) throw new AssigneeAdmissionError("missing", scope);
  if (!channel.assignee) throw new AssigneeAdmissionError("empty", scope);
  if (channel.assignee !== scope.selfId) throw new AssigneeAdmissionError("mismatch", scope);
}

export function matchesAllowedChannel(
  scope: ChannelScope,
  rules: readonly ChannelAllowRule[] | undefined,
): boolean {
  return (
    rules?.some(
      (rule) =>
        (rule.platform === "*" || rule.platform === scope.platform) &&
        (rule.channelId === "*" || rule.channelId === scope.channelId) &&
        (rule.isDirect === undefined || rule.isDirect === (scope.type === "direct")),
    ) ?? false
  );
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

const defaultTranslator: PlatformTranslator = {
  platform: "*",
  async translate(base, session) {
    if (
      session.type !== "message-created" ||
      typeof session.messageId !== "string" ||
      session.messageId.length === 0 ||
      !Array.isArray(session.elements)
    )
      return null;
    return { ...base, messageId: session.messageId, elements: session.elements };
  },
};

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
