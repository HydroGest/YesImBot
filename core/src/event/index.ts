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

export type MessageRecord = Readonly<{
  readonly schemaVersion: 2;
  readonly platform: string;
  readonly selfId: string;
  readonly channel: Universal.Channel;
  readonly user: Universal.User;
  readonly messageId: string;
  readonly elements: readonly Element[];
  readonly text: string;
  readonly timestamp: number;
}>;

export type EventBase = Readonly<{
  readonly schemaVersion: 2;
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

export type ResolvedMessageDraft = Readonly<{
  readonly kind: "message";
  readonly messageId: string;
  readonly elements: readonly Element[];
  readonly text?: string;
  readonly user?: { readonly id?: string; readonly name?: string };
  readonly channel?: { readonly name?: string };
}>;

export type ResolvedEventDraft<K extends keyof EventMap = keyof EventMap> = Readonly<
  { readonly kind: "event"; readonly eventType: K; readonly text: string } & EventMap[K]
>;

export type InputRecord = MessageRecord | EventRecord;

export type Message = CustomMessageBase<"yesimbot.message", Omit<MessageRecord, "timestamp">>;

export type Event<K extends keyof EventMap = keyof EventMap> = CustomMessageBase<
  "yesimbot.event",
  // Keep this distributive conditional so declaration-merged event variants narrow by eventType.
  K extends K ? Omit<EventRecord<K>, "timestamp"> : never
>;

export type Input = Message | Event;

export function isMessageRecord(record: InputRecord): record is MessageRecord {
  return !("eventType" in record);
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

export function createInput(record: InputRecord): Input {
  return isMessageRecord(record) ? createMessage(record) : createEvent(record);
}

export function isMessage(message: AgentMessage): message is Message {
  if (message.role !== "custom" || message.type !== "yesimbot.message") return false;
  const data = message.data;
  return (
    isRecord(data) &&
    data.schemaVersion === 2 &&
    typeof data.platform === "string" &&
    typeof data.selfId === "string" &&
    hasId(data.channel) &&
    hasId(data.user) &&
    typeof data.messageId === "string" &&
    Array.isArray(data.elements) &&
    typeof data.text === "string"
  );
}

export function isEvent(message: AgentMessage): message is Event {
  if (message.role !== "custom" || message.type !== "yesimbot.event") return false;
  const data = message.data;
  return (
    isRecord(data) &&
    data.schemaVersion === 2 &&
    typeof data.platform === "string" &&
    typeof data.selfId === "string" &&
    hasId(data.channel) &&
    typeof data.eventType === "string" &&
    typeof data.text === "string"
  );
}

export function isInput(message: AgentMessage): message is Input {
  return isMessage(message) || isEvent(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string";
}

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "yesimbot.message": Message;
    "yesimbot.event": Event;
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/event": (input: Input) => void;
  }
}
