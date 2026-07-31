import { type Awaitable, type Context, type Logger, type Session, Universal } from "koishi";

import type { AssetService, AssetStore } from "./asset.js";
import type { ChannelScope } from "./channel.js";
import { type PacingConfig } from "./config.js";
import { deliverOutput } from "./delivery.js";
import type {
  EventRecord,
  MessageRecord,
  ResolvedEventDraft,
  ResolvedMessageDraft,
} from "./messages.js";
import type { ChannelRuntimeResult, RuntimeManager } from "./runtime/index.js";

export interface ChannelAllowRule {
  readonly platform: string;
  readonly channelId: string;
  readonly isDirect?: boolean;
}

export interface SessionResolver {
  readonly platform: string;
  resolve(
    session: Session,
    store: AssetStore,
  ): Awaitable<ResolvedMessageDraft | ResolvedEventDraft | null>;
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

  private resolvers = new Map<string, SessionResolver>();
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

  register(resolver: SessionResolver): () => void {
    if (this.resolvers.has(resolver.platform)) {
      throw new Error(`Resolver for platform "${resolver.platform}" is already registered`);
    }
    this.resolvers.set(resolver.platform, resolver);
    return () => {
      if (this.resolvers.get(resolver.platform) === resolver)
        this.resolvers.delete(resolver.platform);
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
      const resolver = this.resolvers.get(session.platform);
      if (!resolver) return;
      const draft = await resolver.resolve(session, this.opts.assets.createStore(scope));
      if (!draft) return;
      const record = createRecord(session, scope, draft);
      const result = await this.opts.runtime.route(record);
      if (result.kind === "run") await this.deliver(session, record, result);
    } catch (cause) {
      this.warn("gateway.resolver_failed", cause, session.platform);
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

function createRecord(
  session: Session,
  scope: ChannelScope,
  draft: ResolvedMessageDraft | ResolvedEventDraft,
): MessageRecord | EventRecord {
  const timestamp = session.timestamp;
  const channel = {
    id: scope.channelId,
    type:
      session.event.channel?.type ??
      (scope.type === "direct" ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT),
    ...(draft.kind === "message" && draft.channel?.name !== undefined
      ? { name: draft.channel.name }
      : session.event.channel?.name === undefined
        ? {}
        : { name: session.event.channel.name }),
  };
  if (draft.kind === "message") {
    return {
      platform: scope.platform,
      selfId: scope.selfId,
      timestamp,
      channel,
      user: {
        id: draft.user?.id ?? session.userId ?? session.event.user?.id ?? session.author?.id ?? "",
        ...((draft.user?.name ?? session.event.user?.name ?? session.author?.name) === undefined
          ? {}
          : { name: draft.user?.name ?? session.event.user?.name ?? session.author?.name }),
      },
      messageId: draft.messageId,
      elements: draft.elements,
    };
  }
  const { kind: _kind, eventType, text, ...variant } = draft;
  return {
    platform: scope.platform,
    selfId: scope.selfId,
    timestamp,
    channel,
    eventType,
    text,
    ...variant,
  } as EventRecord;
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
