import {
  createCustomMessage,
  type AgentMessage,
  type CustomMessageBase,
} from "@yesimbot/agent-runtime";
import type { Element, Universal } from "koishi";

export interface EventMap {
  "delivery.failed": {
    channel: Universal.Channel;
    delivery: {
      turnId: string;
      messageId: string;
      segmentIndex: number;
      segmentTotal: number;
      error: { name: string; message: string; code?: string };
    };
  };
}

export interface RecordBase {
  readonly platform: string;
  readonly selfId: string;
  readonly channel: Universal.Channel;
  readonly user: Universal.User;
  readonly timestamp: number;
}

export type MessageRecord = Readonly<
  RecordBase & {
    readonly messageId: string;
    readonly elements: readonly Element[];
  }
>;

export type EventBase = Readonly<{
  readonly platform: string;
  readonly selfId: string;
  readonly channel: Universal.Channel;
  readonly timestamp: number;
  readonly eventType: string;
  readonly text: string;
}>;

export type EventRecord<K extends keyof EventMap = keyof EventMap> = K extends K
  ? Readonly<EventBase & { readonly eventType: K } & EventMap[K]>
  : never;

export function assembleEvent<K extends keyof EventMap>(
  base: RecordBase,
  payload: { readonly eventType: K; readonly text: string } & Omit<EventMap[K], keyof EventBase>,
): EventRecord<K> {
  return {
    platform: base.platform,
    selfId: base.selfId,
    channel: base.channel,
    timestamp: base.timestamp,
    ...payload,
  } as EventRecord<K>;
}

export type Message = CustomMessageBase<"yesimbot.message", Omit<MessageRecord, "timestamp">>;

export type Event<K extends keyof EventMap = keyof EventMap> = CustomMessageBase<
  "yesimbot.event",
  K extends K ? Omit<EventRecord<K>, "timestamp"> : never
>;

export function isMessageRecord(record: MessageRecord | EventRecord): record is MessageRecord {
  return "messageId" in record;
}

export function isEventRecord<K extends keyof EventMap>(
  record: MessageRecord | EventRecord<K>,
): record is EventRecord<K> {
  return "eventType" in record;
}

export function createMessage(record: MessageRecord): Message {
  const { timestamp: _timestamp, ...data } = record;
  return createCustomMessage("yesimbot.message", data, {
    timestamp: record.timestamp,
  });
}

export function createEvent<K extends keyof EventMap>(record: EventRecord<K>): Event<K>;
export function createEvent(record: EventRecord): Event {
  const { timestamp: _timestamp, ...data } = record;
  return createCustomMessage("yesimbot.event", data, {
    timestamp: record.timestamp,
  });
}

export function isMessage(message: AgentMessage): message is Message {
  return message.role === "custom" && message.type === "yesimbot.message";
}

export function isEvent(message: AgentMessage): message is Event {
  return message.role === "custom" && message.type === "yesimbot.event";
}

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "yesimbot.event": Event;
    "yesimbot.message": Message;
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/event": (input: Event) => void;
    "yesimbot/message": (input: Message) => void;
  }
}
