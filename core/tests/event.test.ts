import type { AgentMessage } from "@yesimbot/agent-runtime";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createEvent,
  isEvent,
  type Event,
  type EventMap,
  type EventRecord,
} from "../src/event/index.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.variant": {
      channel: { id: string };
      test: { value: number };
    };
  }
}

type MessageRecord = EventRecord<"message">;
type TestRecord = EventRecord<"test.variant">;

const messageRecord: MessageRecord = {
  id: "event-1",
  type: "message",
  platform: "test",
  selfId: "bot-1",
  timestamp: 123,
  channel: { id: "channel-1" },
  user: { id: "user-1" },
  message: { id: "message-1", content: "hello" },
  content: "hello",
};

describe("Event", () => {
  it("narrows EventRecord variants from EventMap declaration merging", () => {
    const record = {} as MessageRecord;
    if (record.type === "message") {
      expectTypeOf(record.message).toMatchTypeOf<EventMap["message"]["message"]>();
      expectTypeOf(record.user).toMatchTypeOf<EventMap["message"]["user"]>();
      expectTypeOf(record.channel).toMatchTypeOf<EventMap["message"]["channel"]>();
    }

    const testRecord = {} as TestRecord;
    if (testRecord.type === "test.variant") {
      expectTypeOf(testRecord.test).toMatchTypeOf<{ value: number }>();
      expectTypeOf(testRecord.channel).toMatchTypeOf<{ id: string }>();
    }
  });

  it("creates a persistable Agent custom message using the record timestamp", () => {
    const event = createEvent(messageRecord);

    expect(event).toMatchObject({
      role: "custom",
      type: "yesimbot.event",
      timestamp: 123,
      data: messageRecord,
    });
    expect(JSON.stringify(event)).toContain('"type":"yesimbot.event"');
    expect(JSON.stringify(event)).not.toContain("athena.platform.message");
  });

  it("uses the current time only when the record has no timestamp", () => {
    const now = Date.now;
    Date.now = () => 456;
    try {
      const { timestamp: _timestamp, ...record } = messageRecord;
      expect(createEvent(record).timestamp).toBe(456);
    } finally {
      Date.now = now;
    }
  });

  it("recognizes only yesimbot Event custom messages", () => {
    const event = createEvent(messageRecord);
    const legacy: AgentMessage = {
      id: "legacy-1",
      timestamp: 123,
      role: "custom",
      type: "athena.platform.message",
      data: {},
    } as AgentMessage;

    expect(isEvent(event)).toBe(true);
    expect(isEvent(legacy)).toBe(false);
    expectTypeOf<Event>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.event" }>();
  });
});
