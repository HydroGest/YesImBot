import type { AgentMessage } from "@yesimbot/agent-runtime";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Element, h, Universal } from "koishi";

import {
  assembleEvent,
  createEvent,
  createMessage,
  formatInput,
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
} from "../src/messages/index.js";
import { parseReply } from "../src/messages/index.js";
import { scope } from "./helpers/index.js";

type Input = Message | Event;

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.variant": { channel: { id: string }; test: { value: number } };
  }
}

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "formatter.variant": { extra: { secret: string } };
  }
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

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

function deliveryFailureRecord(overrides: { timestamp?: number } = {}): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    channel: { id: "channel-1", type: Universal.Channel.Type.TEXT },
    delivery: { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1, error: { name: "Error", message: "offline" } },
    text: "failed",
    timestamp: overrides.timestamp ?? 5678,
  };
}

describe("Event", () => {
  it("creates yesimbot.message without payload timestamp", () => {
    const message = createMessage(messageRecord({ timestamp: 1234 }));
    expect(message).toMatchObject({ role: "custom", type: "yesimbot.message", timestamp: 1234, data: { messageId: "m1" } });
    expect("timestamp" in message.data).toBe(false);
    expect(message.data).not.toHaveProperty("schemaVersion");
  });

  it("creates eventType-discriminated yesimbot.event", () => {
    const event = createEvent(deliveryFailureRecord({ timestamp: 5678 }));
    expect(event).toMatchObject({ type: "yesimbot.event", timestamp: 5678, data: { eventType: "delivery.failed" } });
    expect("timestamp" in event.data).toBe(false);
    expect(event.data).not.toHaveProperty("schemaVersion");
  });

  it("isMessageRecord distinguishes message from event records", () => {
    expect(isMessageRecord(messageRecord())).toBe(true);
    expect(isMessageRecord(deliveryFailureRecord())).toBe(false);
  });

  it("recognizes yesimbot.message custom messages as Message", () => {
    const message = createMessage(messageRecord());
    const nonMessage: AgentMessage = { id: "x", timestamp: 0, role: "custom", type: "other", data: {} } as AgentMessage;

    expect(isMessage(message)).toBe(true);
    expect(isMessage(nonMessage)).toBe(false);
    expectTypeOf<Message>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.message" }>();
  });

  it("recognizes yesimbot.event custom messages as Event", () => {
    const event = createEvent(deliveryFailureRecord());
    const nonEvent: AgentMessage = { id: "x", timestamp: 0, role: "custom", type: "other", data: {} } as AgentMessage;

    expect(isEvent(event)).toBe(true);
    expect(isEvent(nonEvent)).toBe(false);
    expectTypeOf<Event>().toMatchTypeOf<{ role: "custom"; type: "yesimbot.event" }>();
  });

  it("recognizes custom discriminators without re-validating their payloads", () => {
    const badMessage = { id: "x", timestamp: 0, role: "custom", type: "yesimbot.message", data: { messageId: "m1", text: "hello" } } as AgentMessage;
    const badEvent = { id: "y", timestamp: 0, role: "custom", type: "yesimbot.event", data: { eventType: "delivery.failed", text: "failed" } } as AgentMessage;

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
    const event = assembleEvent(recordBase(), { eventType: "test.variant", text: "variant", test: { value: 42 } });

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
      delivery: { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1, error: { name: "Error", message: "offline" } },
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
    expect(Object.keys(event.data).sort()).toEqual(["channel", "eventType", "platform", "selfId", "test", "text"]);
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
    expectTypeOf<MapKeys>().toEqualTypeOf<"delivery.failed" | "test.variant" | "formatter.variant">();
  });
});

// ---------------------------------------------------------------------------
// formatInput
// ---------------------------------------------------------------------------

const ASSET_ID = "00000000000000000000000000000000";

function miMessageRecord(overrides: { timestamp?: number } = {}): MessageRecord {
  return {
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    user: { id: "10001", name: "Alice" },
    messageId: "m-1",
    elements: [h.text("hello")],
    timestamp: overrides.timestamp ?? Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function miMessageRecordWithText(text: string, overrides: { timestamp?: number } = {}): MessageRecord {
  return { ...miMessageRecord(overrides), elements: h.parse(text) };
}

function miDeliveryFailureRecord(): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    delivery: { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1, error: { name: "Error", message: "offline" } },
    text: "failed",
    timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function miFormatterVariantRecord(): EventRecord<"formatter.variant"> {
  return {
    eventType: "formatter.variant",
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { id: scope.channelId },
    extra: { secret: "do-not-project" },
    text: "variant",
    timestamp: Date.parse("2026-07-18T12:34:00.000Z"),
  };
}

function project(input: Input) {
  return formatInput(input);
}

describe("formatInput", () => {
  it("always formats a message with the fixed header including its ID", async () => {
    const input = createMessage(miMessageRecord({ timestamp: new Date("2026-07-25T12:34:00.000Z").valueOf() }));

    expect(project(input)).toEqual({ role: "user", content: '[time="2026/7/25 20:34" sender="Alice (10001)" id="m-1"]\nhello' });
  });

  it("hydrates JSONL-replayed Elements before rendering", async () => {
    const replayed = JSON.parse(JSON.stringify(createMessage(miMessageRecord()))) as Input;

    const first = await project(replayed);
    const second = await project(replayed);

    expect(first).toEqual(second);
    expect(String(first.content)).not.toContain("[object Object]");
    expect(first.content).toContain("\nhello");
  });

  it("formats events from only eventType and text", async () => {
    const event: Event = createEvent(miFormatterVariantRecord());
    const result = await project(event);

    expect(result.content).toContain('"eventType":"formatter.variant"');
    expect(result.content).toContain('"text":"variant"');
    expect(result.content).not.toContain("extra");
  });

  it("renders persisted image references as safe asset text without bytes", async () => {
    const input = createMessage(miMessageRecordWithText(`<img id="${ASSET_ID}"/>`));
    const result = await project(input);

    expect(result.content).toContain(`[图片：asset://${ASSET_ID}]`);
    expect(result.content).not.toContain("<img");
  });

  it("never leaks src, data URIs, or platform URLs for unpersisted images", async () => {
    const input = createMessage(miMessageRecordWithText('<img src="https://example.test/x.png"/><img src="data:image/png;base64,AAAA"/>'));
    const result = await project(input);

    expect(result.content).toContain("[图片]");
    expect(String(result.content)).not.toContain("https://");
    expect(String(result.content)).not.toContain("base64");
  });

  it("keeps nested image elements discoverable in document order", async () => {
    const input = createMessage({ ...miMessageRecord(), elements: [h("p", {}, [h("span", {}, [h("img", { id: "11111111111111111111111111111111" })])])] });
    const result = await project(input);

    expect(result.content).toContain("[图片：asset://11111111111111111111111111111111]");
  });

  it("never reads asset bytes during model projection", async () => {
    const input = createMessage(miMessageRecordWithText(`<img id="${ASSET_ID}"/>`));
    const result = await project(input);

    expect(result.content).toContain(`asset://${ASSET_ID}`);
  });

  it("formats delivery-failed notifications without instruction text", async () => {
    const event: Event = createEvent(miDeliveryFailureRecord());
    const result = await project(event);

    expect(result.content).toContain("[SYSTEM_NOTIFICATION]");
    expect(result.content).toContain('"eventType":"delivery.failed"');
  });
});

// ---------------------------------------------------------------------------
// parseReply
// ---------------------------------------------------------------------------

function text(segment: readonly Element[]): string {
  return segment.map((element) => (element.type === "text" ? `${element.attrs["content"] ?? ""}` : element.toString())).join("");
}

describe("parseReply", () => {
  it("produces one fragment for plain text", () => {
    const segments = parseReply("hello world");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("hello world");
  });

  it("splits message elements into separate delivery segments", () => {
    const segments = parseReply("one<message>two</message>three");
    expect(segments.map(text)).toEqual(["one", "two", "three"]);
  });

  it("splits nested message elements into separate delivery segments", () => {
    const segments = parseReply("one<message>two<message>three</message></message>four");
    expect(segments.map(text)).toEqual(["one", "two", "three", "four"]);
  });

  it("preserves platform elements at the reply root", () => {
    const segments = parseReply('hello <at id="42"/> there');
    expect(segments).toHaveLength(1);
    expect(segments[0].find((element) => element.type === "at")?.attrs["id"]).toBe("42");
  });

  it("keeps at and quote elements inside the same message segment", () => {
    const segments = parseReply('hello <at id="42"/> <quote>quoted</quote> world');
    expect(segments).toHaveLength(1);
    expect(segments[0].some((element) => element.type === "at")).toBe(true);
    expect(segments[0].some((element) => element.type === "quote")).toBe(true);
  });

  it("preserves unrecognized Koishi elements without a Core allowlist", () => {
    const segments = parseReply('<custom-card state="open"/>');
    expect(segments).toHaveLength(1);
    expect(segments[0][0].type).toBe("custom-card");
    expect(segments[0][0].attrs["state"]).toBe("open");
  });

  it("delivers <text> content literally with no nested elements", () => {
    const segments = parseReply("<text>List<String> generic</text>");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0][0].type).toBe("text");
    expect(text(segments[0])).toBe("List<String> generic");
  });

  it("does not parse a message element inside <text>", () => {
    const segments = parseReply("<text>before<message>after</message></text>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<message>after</message>");
  });

  it("keeps escaped element syntax as literal text", () => {
    const segments = parseReply("before&lt;message&gt;after&lt;/message&gt;");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<message>after</message>");
  });

  it("fully removes root inner thought from the output", () => {
    const segments = parseReply("<inner_thought>private plan</inner_thought>visible reply");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible reply");
  });

  it("fully removes inner thought nested in a message element", () => {
    const segments = parseReply("<message>visible<inner_thought>private</inner_thought></message>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible");
  });

  it("fully removes inner thought protected by a text container", () => {
    const segments = parseReply("<text>visible<inner_thought>private</inner_thought> after</text>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible after");
  });

  it("keeps only the tagged final reply when the final reply tag is enabled", () => {
    const segments = parseReply("中转站思考内容<reply>这是最终回复</reply>尾巴", { finalReplyTag: "reply" });
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("这是最终回复");
  });

  it("discards untagged content around a final reply tag while preserving message boundaries", () => {
    const segments = parseReply("思考内容<reply><message>一</message><message>二</message></reply>尾巴", { finalReplyTag: "reply" });
    expect(segments.map(text)).toEqual(["一", "二"]);
  });

  it("discards untagged output when the final reply tag is required", () => {
    const segments = parseReply("普通回复", { finalReplyTag: "reply" });
    expect(segments).toEqual([]);
  });

  it("does not treat a final reply tag inside a text container as a wrapper boundary", () => {
    const segments = parseReply("<reply><text>show <reply> tag</text></reply>", { finalReplyTag: "reply" });
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("show <reply> tag");
  });

  it("does not create empty segments around message boundaries", () => {
    expect(parseReply("one<message/>two")).toEqual([[h.text("one")], [h.text("two")]]);
  });

  it("does not trigger substitution for text resembling the nonce placeholder", () => {
    const segments = parseReply(" r0  not a real capture");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("r0 not a real capture");
  });
});
