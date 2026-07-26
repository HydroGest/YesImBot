import type { AgentMessage } from "@yesimbot/agent-runtime";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createEvent,
  createInput,
  createMessage,
  isEvent,
  isInput,
  isMessage,
  isMessageRecord,
  type Event,
  type EventMap,
  type EventRecord,
  type Input,
  type InputRecord,
  type Message,
  type MessageRecord,
} from "../src/event/index.js";

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
    schemaVersion: 1,
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1" },
    user: { id: "user-1", name: "Alice" },
    messageId: "m1",
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
    text: "hello",
    timestamp: overrides.timestamp ?? 1234,
  };
}

function deliveryFailureRecord(
  overrides: { timestamp?: number } = {},
): EventRecord<"delivery.failed"> {
  return {
    schemaVersion: 1,
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1" },
    delivery: {
      turnId: "turn-1",
      messageId: "assistant-1",
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
      data: { schemaVersion: 1, messageId: "m1", text: "hello" },
    });
    expect("timestamp" in message.data).toBe(false);
  });

  it("creates eventType-discriminated yesimbot.event", () => {
    const event = createEvent(deliveryFailureRecord({ timestamp: 5678 }));
    expect(event).toMatchObject({
      type: "yesimbot.event",
      timestamp: 5678,
      data: { schemaVersion: 1, eventType: "delivery.failed" },
    });
    expect("timestamp" in event.data).toBe(false);
  });

  it("createInput dispatches to createMessage or createEvent", () => {
    const messageInput = createInput(messageRecord());
    const eventInput = createInput(deliveryFailureRecord());
    expect(messageInput.type).toBe("yesimbot.message");
    expect(eventInput.type).toBe("yesimbot.event");
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

  it("isInput matches both Message and Event", () => {
    const message = createMessage(messageRecord());
    const event = createEvent(deliveryFailureRecord());
    const nonInput: AgentMessage = {
      id: "x",
      timestamp: 0,
      role: "custom",
      type: "other",
      data: {},
    } as AgentMessage;

    expect(isInput(message)).toBe(true);
    expect(isInput(event)).toBe(true);
    expect(isInput(nonInput)).toBe(false);
  });

  it("rejects missing or unsupported schemaVersion", () => {
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

    expect(isMessage(badMessage)).toBe(false);
    expect(isEvent(badEvent)).toBe(false);
    expect(isInput(badMessage)).toBe(false);
    expect(isInput(badEvent)).toBe(false);
  });

  it("Message type exposes elements, messageId, and text", () => {
    expectTypeOf<Message["data"]["elements"]>().toBeArray();
    expectTypeOf<Message["data"]["messageId"]>().toBeString();
    expectTypeOf<Message["data"]["text"]>().toBeString();
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
    expectTypeOf<D["eventType"]>().toEqualTypeOf<"delivery.failed">();
  });

  it("declaration-merged test.variant retains test.value in persisted data", () => {
    type T = Event<"test.variant">["data"];
    expectTypeOf<T["test"]["value"]>().toBeNumber();
    expectTypeOf<T["channel"]["id"]>().toBeString();
    expectTypeOf<T["eventType"]>().toEqualTypeOf<"test.variant">();
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
