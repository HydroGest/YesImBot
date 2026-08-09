import type { Awaitable, Bot, Context, Element, Logger, Session } from "koishi";
import { Universal } from "koishi";

import type { ChannelScope, Channels } from "../channels/index.js";
import type { ChannelAllowRule, Config, PacingConfig } from "../config.js";
import type { EventRecord, MessageRecord, RecordBase } from "../messages/index.js";
import type { ChannelResources } from "../resources/index.js";
import { persistElements } from "../resources/input.js";
import type { ChannelRuntime, PostOptions, RuntimeResult, Runtimes } from "../runtimes/index.js";
type RunResult = Extract<RuntimeResult, { readonly kind: "run" }>;
type DeliveryContext = { turnId: string; messageId: string; segmentIndex: number; segmentTotal: number };
export interface Translator {
  readonly platform: string;
  translate(session: Session, resources: ChannelResources): Awaitable<MessageRecord | EventRecord | null>;
}
export class Messenger {
  private readonly logger: Logger;
  private readonly translators = new Map<string, Translator>();
  private readonly sessions = new WeakSet<object>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly deliveryTails = new Map<string, Promise<void>>();
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
    return () => {
      if (this.translators.get(translator.platform) === translator) this.translators.delete(translator.platform);
    };
  }

  public async post(event: EventRecord, options?: PostOptions): Promise<void> {
    if (this.closed) return;
    const bot = this.ctx.bots.find((candidate) => candidate.platform === event.platform && candidate.selfId === event.selfId);
    if (!bot) throw new Error(`No Bot is available for ${event.platform}:${event.selfId}`);
    const channel = await this.channels.resolve(scopeFromRecord(event));
    const runtime = await this.runtimes.get(channel, bot);
    const result = await runtime.post(event, options ?? { trigger: true, ifBusy: "defer" });
    if (result.kind === "run") await this.track(this.deliverActive(bot, event.channel.id, runtime, result));
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
    const scope = scopeFromSession(session);
    if (!scope || !matchesAllowedChannel(scope, this.config.allowedChannels)) return;
    try {
      await this.channels.start();
      await assertAssignee(this.ctx, scope, session.selfId);
      const channel = await this.channels.resolve(scope);
      const translator = this.translators.get(session.platform) ?? this.translators.get("*");
      const record = translator ? await translator.translate(session, channel.resources) : await translateDefault(this.ctx, session, channel.resources);
      if (!record) return;
      const bot = this.ctx.bots.find((candidate) => candidate.platform === record.platform && candidate.selfId === record.selfId);
      if (!bot) throw new Error(`No Bot is available for ${record.platform}:${record.selfId}`);
      const runtime = await this.runtimes.get(channel, bot, session);
      const result = await runtime.handle(record);
      if (result.kind === "run") await this.deliverPassive(session, runtime, result);
    } catch (cause) {
      this.warn("messenger.route_failed", cause, session.platform);
    }
  }

  private async deliverPassive(session: Session, runtime: ChannelRuntime, result: RunResult): Promise<void> {
    const delivery = emptyDeliveryContext(result.eventId);
    await this.serializeDelivery(runtime.scope, async () => {
      try {
        for await (const segment of this.pacedSegments(result, delivery)) await session.send([...segment]);
      } catch (cause) {
        await this.failDelivery(runtime, result, delivery, cause);
      }
    });
  }

  private async deliverActive(bot: Bot, channelId: string, runtime: ChannelRuntime, result: RunResult): Promise<void> {
    const delivery = emptyDeliveryContext(result.eventId);
    await this.serializeDelivery(runtime.scope, async () => {
      try {
        for await (const segment of this.pacedSegments(result, delivery)) await bot.sendMessage(channelId, [...segment]);
      } catch (cause) {
        await this.failDelivery(runtime, result, delivery, cause);
      }
    });
  }

  private async *pacedSegments(result: RunResult, delivery: DeliveryContext): AsyncIterable<readonly Element[]> {
    let elapsed = 0;
    for await (const output of result.output) {
      for (const [index, segment] of output.segments.entries()) {
        if (result.signal.aborted) return;
        const delay = pacedDelay(segment, this.config.reply.pacing, elapsed);
        const startedAt = Date.now();
        await sleep(delay, result.signal);
        elapsed += Math.max(delay, Date.now() - startedAt);
        if (result.signal.aborted) return;
        delivery.turnId = output.turnId;
        delivery.messageId = output.messageId;
        delivery.segmentIndex = index + 1;
        delivery.segmentTotal = output.segments.length;
        yield segment;
      }
    }
  }

  private async failDelivery(runtime: ChannelRuntime, result: RunResult, delivery: DeliveryContext, cause: unknown): Promise<void> {
    await runtime.fail(result.eventId, cause, delivery);
    this.warn("delivery.failed", cause, runtime.scope.platform);
  }

  private async serializeDelivery(scope: ChannelScope, task: () => Promise<void>): Promise<void> {
    const key = deliveryKey(scope);
    const previous = this.deliveryTails.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.deliveryTails.set(key, settled);
    try {
      await next;
    } finally {
      if (this.deliveryTails.get(key) === settled) this.deliveryTails.delete(key);
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
async function assertAssignee(ctx: Context, scope: ChannelScope, selfId: string): Promise<void> {
  if (scope.type === "direct") return;
  const [channel] = await ctx.database.get("channel", { platform: scope.platform, id: scope.channelId }, ["assignee"]);
  if (!channel?.assignee || channel.assignee !== selfId) throw new Error("Shared channel assignee admission failed");
}
function scopeFromRecord(record: MessageRecord | EventRecord): ChannelScope {
  return record.channel.type === Universal.Channel.Type.DIRECT
    ? { type: "direct", platform: record.platform, selfId: record.selfId, channelId: record.channel.id }
    : { type: "shared", platform: record.platform, channelId: record.channel.id };
}
function scopeFromSession(session: Session): ChannelScope | undefined {
  if (!session.platform || !session.selfId || !session.channelId) return;
  return session.isDirect
    ? { type: "direct", platform: session.platform, selfId: session.selfId, channelId: session.channelId }
    : { type: "shared", platform: session.platform, channelId: session.channelId };
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
  return { ...base, messageId: session.messageId, elements: await persistElements(ctx, session.elements, resources) };
}
function deliveryKey(scope: ChannelScope): string {
  return scope.type === "direct" ? `direct:${scope.platform}:${scope.selfId}:${scope.channelId}` : `shared:${scope.platform}:${scope.channelId}`;
}
function emptyDeliveryContext(eventId: string): DeliveryContext {
  return { turnId: "", messageId: eventId, segmentIndex: 0, segmentTotal: 0 };
}
function pacedDelay(segment: readonly Element[], pacing: PacingConfig, elapsed: number): number {
  const characters = segment.reduce((total, element) => total + elementTextLength(element), 0);
  const delay = Math.min(Math.max(250, Math.ceil((characters / pacing.charactersPerSecond) * 1000)), 10_000);
  return elapsed + delay >= pacing.maxTotalDelayMs ? 250 : Math.round(delay);
}
function elementTextLength(element: Element): number {
  return (
    (typeof element.attrs.content === "string" ? element.attrs.content.length : 0) +
    element.children.reduce((total, child) => total + elementTextLength(child), 0)
  );
}
function sleep(timeout: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = (
    Promise as PromiseConstructor & { withResolvers<T>(): { promise: Promise<T>; resolve: (value?: T | PromiseLike<T>) => void } }
  ).withResolvers<void>();
  let timer: NodeJS.Timeout;
  const finish = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
    resolve();
  };
  timer = setTimeout(finish, timeout);
  signal.addEventListener("abort", finish, { once: true });
  return promise;
}
