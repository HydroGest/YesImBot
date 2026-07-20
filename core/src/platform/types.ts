import { CustomMessageBase } from "@yesimbot/agent-runtime";
import type { Element, Session } from "koishi";

export namespace Platform {
  export interface Source {
    platform: string;
    selfId: string;
  }

  export interface Diagnostic {
    code: string;
    message: string;
    adapterId?: string;
    eventType?: string;
    nativeType?: string;
    cause?: string;
  }

  export type Scope =
    | { type: "channel"; channelId: string; guildId?: string; threadId?: string }
    | { type: "guild"; guildId: string }
    | { type: "account" };

  export interface Sender {
    id: string;
    name?: string;
  }

  export interface Message {
    source: Source;
    scope: Extract<Scope, { type: "channel" }>;
    sender: Sender;
    messageId: string;
    timestamp?: number;
    receivedAt: number;
    elements: Element[];
  }

  export interface MessageRecord {
    source: Source;
    scope: Message["scope"];
    sender: Sender;
    messageId: string;
    timestamp?: number;
    receivedAt: number;
    content: string;
  }

  export interface Event<K extends keyof PlatformEventVariants = keyof PlatformEventVariants> {
    source: Source;
    scope: Scope;
    type: K;
    timestamp?: number;
    data: PlatformEventVariants[K];
    content: string;
  }

  export interface ImagePrepareSink {
    put(bytes: Uint8Array): Promise<{ assetId: string; mime: string }>;
  }

  export interface ImageBudget {
    maxImages: number;
    maxBytesPerImage: number;
    maxTotalBytes: number;
    timeoutMs: number;
    concurrency: number;
    allowedMime: readonly string[];
  }

  export interface PrepareContext {
    readonly session: Session;
    readonly message: Readonly<Message>;
    readonly images: ImagePrepareSink;
    readonly budget: ImageBudget;
  }

  export type RefineResult =
    | { kind: "keep" }
    | { kind: "ignore" }
    | { kind: "message"; message: Message }
    | { kind: "event"; event: Event };

  export interface Adapter {
    readonly id: string;
    readonly platform?: string;
    readonly adapter?: string;
    readonly profile?: string;
    accepts?(session: Session): boolean;
    refine?(input: { readonly session: Session; readonly base?: Message }): RefineResult;
    prepare?(ctx: PrepareContext): Promise<Element[] | void>;
  }
}

/** Extensible event variant map. Plugins augment this via declaration merging. */
export interface PlatformEventVariants {}

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "athena.platform.message": CustomMessageBase<"athena.platform.message", Platform.MessageRecord>;
  }
}
