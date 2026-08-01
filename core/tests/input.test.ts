import type { AgentMessage } from "@yesimbot/agent-runtime";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, Universal } from "koishi";

import {
  assembleEvent,
  createEvent,
  createMessage,
  isEvent,
  isMessage,
  isMessageRecord,
  type Event,
  type EventBase,
  type EventMap,
  type EventRecord,
  type Message,
  type MessageRecord,
  type RecordBase,
} from "../src/messages.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.variant": {
      channel: { id: string };
      test: { value: number };
    };
  }
}

function messageRecord(overrides: { timestamp?: number } = {}): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT },
    user: { id: "user-1", name: "Alice" },
    messageId: "m1",
    elements: [h.text("hello")],
    timestamp: overrides.timestamp ?? 1234,
  };
}

function recordBase(): RecordBase {
  return {
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT, name: "Room" },
    user: { id: "user-1", name: "Alice" },
    timestamp: 1234,
  };
}

function deliveryFailureRecord(
  overrides: { timestamp?: number } = {},
): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT },
    delivery: {
      turnId: "turn-1",
      messageId: "assistant-1",
      segmentIndex: 1,
      segmentTotal: 1,
      error: { name: "Error", message: "offline" },
    },
    text: "failed",
    timestamp: overrides.timestamp ?? 5678,
  };
}

describe("Event", () => {
  it("creates yesimbot.message without payload timestamp", () => {
    const message = createMessage(messageRecord({ timestamp: 1234 }));
    expect(message).toMatchObject({
      role: "custom",
      type: "yesimbot.message",
      timestamp: 1234,
      data: { messageId: "m1" },
    });
    expect("timestamp" in message.data).toBe(false);
    expect(message.data).not.toHaveProperty("schemaVersion");
  });

  it("creates eventType-discriminated yesimbot.event", () => {
    const event = createEvent(deliveryFailureRecord({ timestamp: 5678 }));
    expect(event).toMatchObject({
      type: "yesimbot.event",
      timestamp: 5678,
      data: { eventType: "delivery.failed" },
    });
    expect("timestamp" in event.data).toBe(false);
    expect(event.data).not.toHaveProperty("schemaVersion");
  });

  it("isMessageRecord distinguishes message from event records", () => {
    expect(isMessageRecord(messageRecord())).toBe(true);
    expect(isMessageRecord(deliveryFailureRecord())).toBe(false);
  });

  it("recognizes yesimbot.message custom messages as Message", () => {
    const message = createMessage(messageRecord());
    const nonMessage: AgentMessage = {
      id: "x",
      timestamp: 0,
      role: "custom",
      type: "other",
      data: {},
    } as AgentMessage;

    expect(isMessage(message)).toBe(true);
    expect(isMessage(nonMessage)).toBe(false);
    expectTypeOf<Message>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.message" }>();
  });

  it("recognizes yesimbot.event custom messages as Event", () => {
    const event = createEvent(deliveryFailureRecord());
    const nonEvent: AgentMessage = {
      id: "x",
      timestamp: 0,
      role: "custom",
      type: "other",
      data: {},
    } as AgentMessage;

    expect(isEvent(event)).toBe(true);
    expect(isEvent(nonEvent)).toBe(false);
    expectTypeOf<Event>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.event" }>();
  });

  it("recognizes custom discriminators without re-validating their payloads", () => {
    const badMessage = {
      id: "x",
      timestamp: 0,
      role: "custom",
      type: "yesimbot.message",
      data: { messageId: "m1", text: "hello" },
    } as AgentMessage;
    const badEvent = {
      id: "y",
      timestamp: 0,
      role: "custom",
      type: "yesimbot.event",
      data: { eventType: "delivery.failed", text: "failed" },
    } as AgentMessage;

    expect(isMessage(badMessage)).toBe(true);
    expect(isEvent(badEvent)).toBe(true);
  });

  it("Message type exposes elements and messageId", () => {
    expectTypeOf<Message["data"]["elements"]>().toBeArray();
    expectTypeOf<Message["data"]["messageId"]>().toBeString();
  });

  it("Event type exposes eventType and text", () => {
    expectTypeOf<Event["data"]["eventType"]>().toBeString();
    expectTypeOf<Event["data"]["text"]>().toBeString();
  });

  it("Event data excludes timestamp from persisted payload", () => {
    // Prove "timestamp" is not a key of Event["data"].
    type _Assert = "timestamp" extends keyof Event["data"] ? never : true;
    expect(true as _Assert).toBe(true);
  });

  it("delivery.failed variant retains delivery field in persisted data", () => {
    type D = Event<"delivery.failed">["data"];
    expectTypeOf<D["delivery"]["turnId"]>().toBeString();
    expectTypeOf<D["delivery"]["messageId"]>().toBeString();
    expectTypeOf<D["delivery"]["segmentIndex"]>().toBeNumber();
    expectTypeOf<D["delivery"]["segmentTotal"]>().toBeNumber();
    expectTypeOf<D["eventType"]>().toEqualTypeOf<"delivery.failed">();
  });

  it("declaration-merged test.variant retains test.value in persisted data", () => {
    type T = Event<"test.variant">["data"];
    expectTypeOf<T["test"]["value"]>().toBeNumber();
    expectTypeOf<T["channel"]["id"]>().toBeString();
    expectTypeOf<T["eventType"]>().toEqualTypeOf<"test.variant">();
  });

  it("assembles events from RecordBase without copying user", () => {
    const event = assembleEvent(recordBase(), {
      eventType: "test.variant",
      text: "variant",
      test: { value: 42 },
    });

    expect(event).toMatchObject({
      platform: "test",
      selfId: "bot-1",
      channel: { id: "channel-1", name: "Room" },
      eventType: "test.variant",
      text: "variant",
      test: { value: 42 },
    });
    expect(event).not.toHaveProperty("user");
  });
  it("assembles delivery.failed without payload channel or user residue", () => {
    const event = assembleEvent(recordBase(), {
      eventType: "delivery.failed",
      text: "Delivery failed",
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 1,
        error: { name: "Error", message: "offline" },
      },
    });

    expect(event).toMatchObject({
      eventType: "delivery.failed",
      text: "Delivery failed",
      channel: { id: "channel-1", name: "Room" },
      delivery: { turnId: "turn-1", messageId: "assistant-1" },
    });
    expect(event).not.toHaveProperty("user");
  });

  it("constructs a declaration-merged event from the closed host base", () => {
    const event = createEvent({
      eventType: "test.variant",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "channel-1" },
      timestamp: 5678,
      text: "variant",
      test: { value: 42 },
    });

    expect(event.data).toMatchObject({
      eventType: "test.variant",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "channel-1" },
      text: "variant",
      test: { value: 42 },
    });
    expect(Object.keys(event.data).sort()).toEqual([
      "channel",
      "eventType",
      "platform",
      "selfId",
      "test",
      "text",
    ]);
    expect(event.data).not.toHaveProperty("message");
    expect(event.data).not.toHaveProperty("content");
    expect(event.data).not.toHaveProperty("type");
  });

  it("keeps message and event host records free of Universal.Event residue", () => {
    expectTypeOf<MessageRecord>().toHaveProperty("messageId");
    expectTypeOf<MessageRecord>().toHaveProperty("elements");
    expectTypeOf<MessageRecord>().not.toHaveProperty("guild");
    expectTypeOf<MessageRecord>().not.toHaveProperty("member");
    expectTypeOf<EventBase>().toHaveProperty("eventType");
    expectTypeOf<EventBase>().toHaveProperty("text");
    expectTypeOf<EventBase>().not.toHaveProperty("guild");
    expectTypeOf<EventBase>().not.toHaveProperty("member");
  });

  it("rejects inherited Universal.Event resources from a message record", () => {
    // @ts-expect-error MessageRecord must not admit Universal.Event residue.
    const record: MessageRecord = { ...messageRecord(), guild: { id: "guild-1" } };

    expect(record.messageId).toBe("m1");
  });

  it("createEvent returns variant-specific Event type", () => {
    const event = createEvent(deliveryFailureRecord());
    expectTypeOf(event.data.eventType).toEqualTypeOf<"delivery.failed">();
    expectTypeOf(event.data.delivery.turnId).toBeString();
    expectTypeOf(event.data.text).toBeString();
  });

  it("EventMap no longer contains a message variant", () => {
    type MapKeys = keyof EventMap;
    expectTypeOf<MapKeys>().toEqualTypeOf<"delivery.failed" | "test.variant">();
  });
});
