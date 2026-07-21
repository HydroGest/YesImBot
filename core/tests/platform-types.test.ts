import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h, type Element } from "koishi";

import type { Platform } from "../src/platform/index.js";

declare module "../src/platform/types.js" {
  interface PlatformEventVariants {
    "test.action": { value: number };
  }
}

describe("Platform contracts", () => {
  it("uses Koishi Element and a channel-only MessageRecord", () => {
    expectTypeOf<Platform.Message["elements"]>().toEqualTypeOf<Element[]>();
    expectTypeOf<Platform.MessageRecord["scope"]>().toEqualTypeOf<Platform.Message["scope"]>();

    const message: Platform.Message = {
      source: { platform: "test", selfId: "bot" },
      scope: { type: "channel", channelId: "room", channelType: "group" },
      sender: { id: "user", name: "Alice" },
      messageId: "m-1",
      receivedAt: 1,
      elements: [h.text("hello")],
    };

    expect(message.sender).toEqual({ id: "user", name: "Alice" });
    expect(message.elements[0]?.type).toBe("text");
    expect(message).not.toHaveProperty("version");
    expect(message).not.toHaveProperty("resources");
    expect(message).not.toHaveProperty("extensions");
    expect(message).not.toHaveProperty("author");
    expect(message).not.toHaveProperty("content");

    const record: Platform.MessageRecord = {
      source: { platform: "test", selfId: "bot" },
      scope: { type: "channel", channelId: "room", channelType: "group" },
      sender: { id: "user" },
      messageId: "m1",
      receivedAt: 1,
      content: h.text("hello").toString(),
    };
    expect(record.content).toBe("hello");
  });

  it("types Adapter.prepare to return elements via PrepareContext.images sink", () => {
    const adapter: Platform.Adapter = {
      id: "t",
      async prepare(ctx) {
        const sink: Platform.ImagePrepareSink = ctx.images;
        expect(typeof sink.put).toBe("function");
        return ctx.message.elements;
      },
    };
    expect(adapter.id).toBe("t");
  });

  it("does not expose receipt time on events", () => {
    const event: Platform.Event<"test.action"> = {
      source: { platform: "onebot", selfId: "10000" },
      scope: { type: "channel", channelId: "20000" },
      type: "test.action",
      data: { value: 42 },
      content: "test action occurred",
    };

    expect(event.type).toBe("test.action");
    expect(event.data).toEqual({ value: 42 });
    const invalid: Platform.Event<"test.action"> = {
      ...event,
      // @ts-expect-error Event no longer contains core receipt time
      receivedAt: 1,
    };
    expect(invalid).toBeDefined();
  });

  it("exposes short namespace types", () => {
    const scope: Platform.Scope = { type: "account" };
    expect(scope.type).toBe("account");
  });

  it("supports sender without display name", () => {
    const message: Platform.Message = {
      source: { platform: "onebot", selfId: "10000" },
      scope: { type: "channel", channelId: "20000", channelType: "group" },
      sender: { id: "30000" },
      messageId: "40000",
      receivedAt: 1,
      elements: [h.text("hello")],
    };

    expect(message.sender).toEqual({ id: "30000" });
  });

  it("allows declared events with no timestamp", () => {
    const event: Platform.Event<"test.action"> = {
      source: { platform: "onebot", selfId: "10000" },
      scope: { type: "channel", channelId: "20000" },
      type: "test.action",
      data: { value: 1 },
      content: "",
    };

    expect(event.timestamp).toBeUndefined();
  });

  it("removes legacy public type names", () => {
    const data = {
      source: { platform: "test", selfId: "bot" },
      scope: { type: "channel" as const, channelId: "c", channelType: "group" as const },
      sender: { id: "u" },
      messageId: "m",
      receivedAt: 1,
      content: "hello",
    };
    const record: Platform.MessageRecord = data;
    expect(record.content).toBe("hello");

    // @ts-expect-error MsgElement was replaced by Koishi Element
    expectTypeOf<import("../src/platform/types.js").MsgElement>();
    // @ts-expect-error PersistedPlatformMessage was renamed without an alias
    expectTypeOf<import("../src/platform/types.js").PersistedPlatformMessage>();
  });

  it("rejects non-channel MessageRecord scopes", () => {
    const record: Platform.MessageRecord = {
      source: { platform: "test", selfId: "bot" },
      // @ts-expect-error MessageRecord is persisted only for channel messages
      scope: { type: "account" },
      sender: { id: "user" },
      messageId: "m1",
      receivedAt: 1,
      content: "hello",
    };
    expect(record).toBeDefined();
  });
});
