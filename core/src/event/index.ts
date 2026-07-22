import {
  createCustomMessage,
  type AgentMessage,
  type CustomMessageBase,
} from "@yesimbot/agent-runtime";
import type { Universal } from "koishi";

export interface EventMap {
  message: {
    channel: Universal.Channel;
    user: Universal.User;
    message: Universal.Message;
  };
  "delivery.failed": {
    channel: Universal.Channel;
    delivery: {
      turnId: string;
      messageId: string;
      error: { name: string; message: string; code?: string };
    };
  };
}

export type EventRecord<K extends keyof EventMap = keyof EventMap> = {
  [P in K]: Readonly<Omit<Universal.Event, "type"> & { type: P; content?: string } & EventMap[P]>;
}[K];

export type Event<K extends keyof EventMap = keyof EventMap> = CustomMessageBase<
  "yesimbot.event",
  EventRecord<K>
>;

export function createEvent(record: EventRecord): Event {
  return createCustomMessage("yesimbot.event", record, {
    timestamp: record.timestamp ?? Date.now(),
  });
}

export function isEvent(message: AgentMessage): message is Event {
  return message.role === "custom" && message.type === "yesimbot.event";
}

declare module "@yesimbot/agent-runtime" {
  interface AgentCustomMessages {
    "yesimbot.event": Event;
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/event": (event: Event) => void;
  }
}
