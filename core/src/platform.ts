import type { CustomMessageBase } from "@yesimbot/agent-runtime";

export interface PlatformSource {
  platform: string;
  selfId: string;
  channelId: string;
  guildId?: string;
  threadId?: string;
  conversationType: "private" | "group" | "guild" | "thread";
}

export interface PlatformAuthor {
  id: string;
  name?: string;
  nick?: string;
  avatar?: string;
  isSelf?: boolean;
}

export interface PlatformMessageAttachment {
  id: string;
  type: string;
  url: string;
  source?: string;
}

export interface PlatformMessage {
  version: 1;
  source: PlatformSource;
  author: PlatformAuthor;
  message: {
    messageId: string;
    content: string;
    timestamp: number;
    attachments?: PlatformMessageAttachment[];
    quote?: {
      messageId: string;
      author?: PlatformAuthor;
    };
  };
}

export interface PlatformEventVariants {}

export type PlatformEventSubType = keyof PlatformEventVariants & string;

export type PlatformEvent<K extends string = string> = {
  version: 1;
  subType: K;
  source: PlatformSource;
  author: PlatformAuthor;
  operator?: PlatformAuthor;
} & (K extends PlatformEventSubType ? PlatformEventVariants[K] : Record<string, unknown>);

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "athena.platform.message": CustomMessageBase<"athena.platform.message", PlatformMessage>;
    "athena.platform.event": CustomMessageBase<"athena.platform.event", PlatformEvent>;
  }
}
