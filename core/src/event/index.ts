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

export interface MessageData extends Readonly<
  Omit<Universal.Event, "type" | "timestamp" | "message" | "content">
> {
  readonly schemaVersion: 1;
  readonly platform: string;
  readonly selfId: string;
  readonly channel: Universal.Channel;
  readonly user: Universal.User;
  readonly messageId: string;
  readonly elements: readonly Element[];
  readonly text: string;
}

export type MessageRecord = Readonly<MessageData & { readonly timestamp: number }>;

export type EventRecord<K extends keyof EventMap = keyof EventMap> = {
  [P in K]: Readonly<Omit<Universal.Event, "type" | "timestamp" | "message" | "content">> & {
    readonly schemaVersion: 1;
    readonly eventType: P;
    readonly text: string;
    readonly platform: string;
    readonly selfId: string;
    readonly channel: Universal.Channel;
    readonly timestamp: number;
  } & EventMap[P];
}[K];

export type InputRecord = MessageRecord | EventRecord;

export type Message = CustomMessageBase<"yesimbot.message", MessageData>;

export type Event<K extends keyof EventMap = keyof EventMap> = CustomMessageBase<
  "yesimbot.event",
  // Keep this distributive conditional so declaration-merged event variants narrow by eventType.
  K extends K ? Omit<EventRecord<K>, "timestamp"> : never
>;

export type Input = Message | Event;

function isMessageRecord(record: InputRecord): record is MessageRecord {
  return !("eventType" in record);
}

export { isMessageRecord };

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
    typeof data === "object" && data !== null && "schemaVersion" in data && data.schemaVersion === 1
  );
}

export function isEvent(message: AgentMessage): message is Event {
  if (message.role !== "custom" || message.type !== "yesimbot.event") return false;
  const data = message.data;
  return (
    typeof data === "object" && data !== null && "schemaVersion" in data && data.schemaVersion === 1
  );
}

export function isInput(message: AgentMessage): message is Input {
  return isMessage(message) || isEvent(message);
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
