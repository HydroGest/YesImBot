import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, h, Service, type Element, type Session } from "koishi";

import type { ChannelScope } from "../channel.js";
import type { Config } from "../config.js";
import { resolveBasePath } from "../runtime/key.js";
import { AssetStore } from "./assets.js";
import { DEFAULT_PLATFORM, type PlatformConfig } from "./config.js";
import { draftMessageFromSession, projectPlatformMessage, sealMessage } from "./message.js";
import type { Platform, PlatformEventVariants } from "./types.js";

type Listener = (event: Platform.Event) => void;

const IMAGE_BUDGET: Platform.ImageBudget = {
  maxImages: 4,
  maxBytesPerImage: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  timeoutMs: 10_000,
  concurrency: 2,
  allowedMime: ["image/jpeg", "image/png", "image/webp", "image/gif"],
};

interface MatchInput {
  platform: string;
  adapter?: string;
  profile?: string;
  session: Session;
}

interface SessionAdapterState {
  adapter?: Platform.Adapter;
  failed: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function id(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function copyElements(elements: readonly Element[]): Element[] {
  return elements.map((element) =>
    h(element.type, { ...element.attrs }, copyElements(element.children)),
  );
}

function createPreparationView(message: Platform.Message): Platform.Message {
  return {
    source: { ...message.source },
    scope: { ...message.scope },
    sender: { ...message.sender },
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    elements: copyElements(message.elements),
    ...(message.timestamp === undefined ? {} : { timestamp: message.timestamp }),
  };
}

function matchRank(adapter: Platform.Adapter, input: MatchInput): number | undefined {
  const descriptors = [
    [adapter.profile, input.profile, 3],
    [adapter.adapter, input.adapter, 2],
    [adapter.platform, input.platform, 1],
  ] as const;
  const declared = descriptors.filter(([expected]) => expected !== undefined);
  if (!declared.length || declared.some(([expected, actual]) => expected !== actual))
    return undefined;
  return Math.max(...declared.map(([, , rank]) => rank));
}

declare module "koishi" {
  interface Context {
    "yesimbot.platform": PlatformService;
  }
}

export class PlatformService extends Service<Config> {
  private readonly adapters = new Map<string, Platform.Adapter>();
  private readonly listeners = new Set<Listener>();
  private readonly sessionMessages = new WeakMap<Session, Platform.Message>();
  private readonly sessionAdapters = new WeakMap<Session, SessionAdapterState>();
  private readonly collectedSessions = new WeakSet<Session>();
  private readonly assetStore: AssetStore;
  private readonly configuredPlatform: PlatformConfig;

  constructor(ctx: Context, config: Config) {
    super(ctx, "yesimbot.platform", true);
    this.configuredPlatform = { ...DEFAULT_PLATFORM, ...(config.platform ?? {}) };
    this.assetStore = new AssetStore({
      basePath: resolveBasePath(config.basePath, ctx.baseDir),
      maxFileBytes: IMAGE_BUDGET.maxBytesPerImage,
    });
    ctx.on("internal/session", (session: Session) => this.collectSession(session));
  }

  get platformConfig(): PlatformConfig {
    return this.configuredPlatform;
  }

  register(adapter: Platform.Adapter): () => void {
    if (!adapter.id?.trim()) throw new Error("Platform adapter id is required");
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Platform adapter "${adapter.id}" is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id);
    };
  }

  publish<K extends keyof PlatformEventVariants>(event: Platform.Event<K>): Platform.Event<K> {
    this.notifyEvent(event);
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getMessage(session: Session): Platform.Message | undefined {
    return this.sessionMessages.get(session);
  }

  collectIfNeeded(session: Session): Platform.Message | undefined {
    if (!this.collectedSessions.has(session)) this.collectSession(session);
    return this.sessionMessages.get(session);
  }

  createMessagePlugin(deps: {
    scope: ChannelScope;
    includeMessageId: boolean;
    diagnostic?: (diagnostic: { event: string; hash: string; cause: string }) => void;
  }): AgentPlugin {
    const { scope, includeMessageId, diagnostic } = deps;
    const assetStore = this.assetStore;
    return {
      name: "core.platform-message",
      async toModelMessages(message) {
        if (message.role !== "custom" || message.type !== "athena.platform.message")
          return undefined;
        return projectPlatformMessage(message.data, {
          scope,
          assetStore,
          includeMessageId,
          onAssetMissing: (assetId, cause) =>
            diagnostic?.({
              event: "platform.asset_missing",
              hash: assetId,
              cause: errorMessage(cause),
            }),
        });
      },
    };
  }

  async prepareMessage(session: Session, message: Platform.Message): Promise<Platform.Message> {
    if (!this.collectedSessions.has(session)) {
      throw new Error("Platform message must be collected before preparation");
    }
    const state = this.sessionAdapters.get(session);
    const scope: ChannelScope = {
      platform: message.source.platform,
      selfId: message.source.selfId,
      channelId: message.scope.channelId,
    };
    const snapshot = createPreparationView(message);
    let elements = snapshot.elements;
    if (!state?.failed && state?.adapter?.prepare) {
      try {
        const replaced = await state.adapter.prepare({
          session,
          message: createPreparationView(snapshot),
          images: { put: (bytes) => this.assetStore.put(scope, bytes) },
          budget: IMAGE_BUDGET,
        });
        if (replaced !== undefined) elements = replaced;
      } catch (error) {
        this.reportDiagnostic({
          code: "platform.prepare_failed",
          message: "Platform adapter prepare failed",
          adapterId: state.adapter.id,
          cause: errorMessage(error),
        });
      }
    }
    return sealMessage({ ...snapshot, elements });
  }

  async clearChannel(scope: ChannelScope): Promise<void> {
    await this.assetStore.clear(scope);
  }

  private selectAdapter(input: MatchInput): SessionAdapterState {
    const ranked = new Map<number, Platform.Adapter[]>();
    for (const adapter of this.adapters.values()) {
      const rank = matchRank(adapter, input);
      if (rank !== undefined) ranked.set(rank, [...(ranked.get(rank) ?? []), adapter]);
    }
    for (const rank of [...ranked.keys()].sort((a, b) => b - a)) {
      const accepted: Platform.Adapter[] = [];
      for (const adapter of ranked.get(rank) ?? []) {
        try {
          if (adapter.accepts?.(input.session) === false) continue;
          accepted.push(adapter);
        } catch (error) {
          this.reportDiagnostic({
            code: "platform.adapter_accept_failed",
            message: `Platform adapter "${adapter.id}" failed while accepting input`,
            adapterId: adapter.id,
            cause: errorMessage(error),
          });
          return { failed: true };
        }
      }
      if (accepted.length === 0) continue;
      if (accepted.length > 1) {
        const ids = accepted.map((adapter) => adapter.id).sort();
        throw new Error(`Platform adapter conflict at rank ${rank}: ${ids.join(", ")}`);
      }
      return { adapter: accepted[0], failed: false };
    }
    return { failed: false };
  }

  private collectSession(session: Session): void {
    if (this.collectedSessions.has(session)) return;
    this.collectedSessions.add(session);
    const base = draftMessageFromSession(session, Date.now());
    const profile = session.bot?.sid
      ? this.configuredPlatform.profiles?.[session.bot.sid]
      : undefined;
    const state = this.selectAdapter({
      platform: session.platform,
      adapter: id(record(session.bot).adapterName),
      profile,
      session,
    });
    this.sessionAdapters.set(session, state);
    if (state.failed || !state.adapter?.refine) {
      if (base) this.sessionMessages.set(session, base);
      return;
    }
    try {
      const result = state.adapter.refine({ session, ...(base ? { base } : {}) });
      switch (result.kind) {
        case "keep":
          if (base) this.sessionMessages.set(session, base);
          return;
        case "ignore":
          return;
        case "event":
          this.notifyEvent(result.event);
          return;
        case "message":
          if (!base) {
            state.failed = true;
            this.reportDiagnostic({
              code: "platform.invalid_refine_result",
              message: `Platform adapter "${state.adapter.id}" returned a message without a base`,
              adapterId: state.adapter.id,
            });
            return;
          }
          this.sessionMessages.set(session, { ...result.message, receivedAt: base.receivedAt });
      }
    } catch (error) {
      state.failed = true;
      this.reportDiagnostic({
        code: "platform.adapter_refine_failed",
        message: `Platform adapter "${state.adapter.id}" failed while refining input`,
        adapterId: state.adapter.id,
        cause: errorMessage(error),
      });
      if (base) this.sessionMessages.set(session, base);
    }
  }

  private notifyEvent(event: Platform.Event): void {
    for (const listener of [...this.listeners]) {
      try {
        const result = listener(event) as unknown;
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((error) =>
            this.reportDiagnostic({
              code: "platform.listener_failed",
              message: "Platform event listener rejected",
              cause: errorMessage(error),
            }),
          );
        }
      } catch (error) {
        this.reportDiagnostic({
          code: "platform.listener_failed",
          message: "Platform event listener failed",
          cause: errorMessage(error),
        });
      }
    }
  }

  private reportDiagnostic(diagnostic: Platform.Diagnostic): void {
    try {
      this.logger.warn(diagnostic);
    } catch {
      // Diagnostics cannot interrupt message collection.
    }
  }
}
