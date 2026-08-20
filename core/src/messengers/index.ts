import type { Awaitable, Context, Logger, Session } from "koishi";
import { Universal } from "koishi";

import type { Channels } from "../channels/index.js";
import { type ChannelContext, contextFromSession, contextFromRecord } from "../channels/index.js";
import type { ChannelAllowRule, Config } from "../config.js";
import type { EventRecord, MessageRecord, RecordBase } from "../messages/index.js";
import type { ChannelResources } from "../resources/index.js";
import type { PostOptions, Runtimes } from "../runtimes/index.js";

export interface Translator {
  readonly platform: string;
  translate(session: Session, resources: ChannelResources): Awaitable<MessageRecord | EventRecord | null>;
}

export class Messenger {
  private readonly logger: Logger;
  private readonly translators = new Map<string, Translator>();
  private readonly sessions = new WeakSet<object>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly disposers: Array<() => unknown> = [];
  private closed = false;

  public constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly channels: Channels,
    private readonly runtimes: Runtimes,
  ) {
    this.logger = ctx.logger("yesimbot.messenger");
    this.logger.level = config.logLevel ?? 2;
    const middleware = ctx.middleware(async (session, next) => {
      try {
        await this.handle(session);
      } finally {
        await next();
      }
    });
    if (typeof middleware === "function") this.disposers.push(middleware);
    const internal = ctx.on("internal/session", (session) => {
      if (session.type !== "message-created") void this.handle(session);
    });
    if (typeof internal === "function") this.disposers.push(internal);
  }

  public use(translator: Translator): () => void {
    if (this.translators.has(translator.platform)) {
      throw new Error(`Translator for platform "${translator.platform}" is already registered`);
    }
    this.translators.set(translator.platform, translator);
    this.logger.debug("messenger.translator_registered", { platform: translator.platform });
    return () => {
      if (this.translators.get(translator.platform) === translator) {
        this.translators.delete(translator.platform);
        this.logger.debug("messenger.translator_unregistered", { platform: translator.platform });
      }
    };
  }

  public async post(event: EventRecord, options?: PostOptions): Promise<void> {
    if (this.closed) return;
    const bot = this.ctx.bots.find((candidate) => candidate.platform === event.platform && candidate.selfId === event.selfId);
    if (!bot) throw new Error(`No Bot is available for ${event.platform}:${event.selfId}`);
    const channel = await this.channels.resolve(contextFromRecord(event)!);
    const runtime = await this.runtimes.get(channel, bot);
    const postOptions = options ?? { trigger: true, ifBusy: "defer" };
    const result = await runtime.post(event, postOptions);
    this.logger.debug("messenger.post", {
      eventType: event.eventType,
      platform: event.platform,
      channelId: event.channel.id,
      result: result.kind,
      eventId: result.eventId,
    });
    if (result.kind === "run") await this.track(result.done);
  }

  public async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
    await this.runtimes.stop();
    await Promise.allSettled([...this.tasks]);
  }

  private async handle(session: Session): Promise<void> {
    if (this.closed || this.sessions.has(session)) return;
    this.sessions.add(session);
    await this.track(this.route(session));
  }

  private async route(session: Session): Promise<void> {
    const ctx = contextFromSession(session);
    const routeId = session.messageId ?? String(session.id);
    if (!ctx || !matchesAllowedChannel(ctx, this.config.allowedChannels)) return;
    try {
      await this.channels.start();
      await assertAssignee(this.ctx, ctx, session.selfId);
      const channel = await this.channels.resolve(ctx);
      const translator = this.translators.get(session.platform) ?? this.translators.get("*");
      const record = translator ? await translator.translate(session, channel.resources) : await translateDefault(this.ctx, session, channel.resources);
      if (!record) return;
      this.logger.debug("messenger.route.record", {
        routeId,
        recordType: "messageId" in record ? "message" : "event",
        platform: record.platform,
        selfId: record.selfId,
        channelId: record.channel.id,
      });
      const bot = this.ctx.bots.find((candidate) => candidate.platform === record.platform && candidate.selfId === record.selfId);
      if (!bot) throw new Error(`No Bot is available for ${record.platform}:${record.selfId}`);
      const runtime = await this.runtimes.get(channel, bot, session);
      const result = await runtime.handle(record);
      this.logger.debug("messenger.route.result", { routeId, result: result.kind, eventId: result.eventId });
      if (result.kind === "run") await result.done;
    } catch (cause) {
      this.warn("messenger.route_failed", cause, session.platform);
    }
  }

  private async track(task: Promise<void>): Promise<void> {
    this.tasks.add(task);
    try {
      await task;
    } finally {
      this.tasks.delete(task);
    }
  }

  private warn(code: string, cause: unknown, platform: string): void {
    try {
      this.logger.warn({ code, platform, cause: cause instanceof Error ? cause.message : String(cause) });
    } catch {}
  }
}

export function matchesAllowedChannel(ctx: ChannelContext, rules: readonly ChannelAllowRule[] | undefined): boolean {
  return (
    rules?.some(
      (rule) =>
        (rule.platform === "*" || rule.platform === ctx.platform) &&
        (rule.channelId === "*" || rule.channelId === ctx.channelId) &&
        (rule.isDirect === undefined || rule.isDirect === (ctx.type === "direct")),
    ) ?? false
  );
}

async function assertAssignee(koishiCtx: Context, ctx: ChannelContext, selfId: string): Promise<void> {
  if (ctx.type === "direct") return;
  const [channel] = await koishiCtx.database.get("channel", { platform: ctx.platform, id: ctx.channelId }, ["assignee"]);
  if (!channel?.assignee || channel.assignee !== selfId) throw new Error("Shared channel assignee admission failed");
}

async function translateDefault(ctx: Context, session: Session, resources: ChannelResources): Promise<MessageRecord | null> {
  if (session.type !== "message-created" || !session.messageId || !session.channelId || !Array.isArray(session.elements)) return null;
  const base: RecordBase = {
    platform: session.platform,
    selfId: session.selfId,
    timestamp: session.timestamp,
    channel: {
      id: session.channelId,
      type: session.event.channel?.type ?? (session.isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT),
      ...(session.event.channel?.name === undefined ? {} : { name: session.event.channel.name }),
    },
    user: {
      id: session.userId || session.event.user?.id || session.author?.id || "",
      ...((session.event.user?.name ?? session.author?.name) === undefined ? {} : { name: session.event.user?.name ?? session.author?.name }),
    },
  };
  return { ...base, messageId: session.messageId, elements: await resources.persistElements(ctx, session.elements) };
}
