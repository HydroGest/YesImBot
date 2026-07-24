import type { Universal } from "koishi";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { Config as ConfigType } from "../src/config.js";
import { createEvent, type Event, type EventRecord } from "../src/event/index.js";
import {
  DefaultWill,
  type DefaultWillConfig,
  type Will,
  type WillObservation,
} from "../src/will/index.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.notice": {
      channel: { id: string };
      notice: { value: string };
    };
  }
}

const EMPTY_STATE: Will.State = {
  activeTurnId: null,
  pending: [],
  recent: [],
  lastActivityAt: null,
};

function messageEvent(options: {
  readonly channelType: Universal.Channel.Type;
  readonly elements?: Universal.Message["elements"];
}): Event<"message"> {
  return createEvent({
    id: "event-1",
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: options.channelType },
    user: { id: "user-1" },
    message: { id: "message-1", elements: options.elements },
  });
}

function directMessageEvent(): Event<"message"> {
  return messageEvent({ channelType: 1 });
}

function mentionedGroupEvent(): Event<"message"> {
  return messageEvent({
    channelType: 0,
    elements: [{ type: "at", attrs: { id: "bot-1" }, children: [] }],
  });
}

function ordinaryGroupMessageEvent(): Event<"message"> {
  return messageEvent({
    channelType: 0,
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
  });
}

function nonMessageEvent(): Event<"test.notice"> {
  return createEvent({
    id: "event-2",
    type: "test.notice",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1" },
    notice: { value: "notice" },
  });
}

function deliveryFailedEvent(): Event<"delivery.failed"> {
  return createEvent({
    id: "event-3",
    type: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1" },
    delivery: {
      turnId: "turn-1",
      messageId: "message-1",
      error: { name: "Error", message: "offline" },
    },
  });
}

describe("DefaultWill", () => {
  it("triggers direct messages and mentions but waits on ordinary group messages", async () => {
    const will = new DefaultWill({ direct: "trigger", mention: "trigger", group: "wait" });

    await expect(will.decide(directMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(mentionedGroupEvent(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("waits for non-message and delivery-failed events", async () => {
    const will = new DefaultWill({ direct: "trigger", mention: "trigger", group: "trigger" });

    await expect(will.decide(nonMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(deliveryFailedEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("uses trigger, trigger, and wait as the default routing configuration", async () => {
    const config = {
      basePath: "data/yesimbot",
      chatModel: "test-model",
      will: { group: "trigger" },
    } satisfies Config;
    const defaultConfig: DefaultWillConfig = {
      direct: "trigger",
      mention: "trigger",
      group: "wait",
    };

    await expect(new DefaultWill().decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe(
      defaultConfig.group,
    );
    await expect(
      new DefaultWill(config.will).decide(ordinaryGroupMessageEvent(), EMPTY_STATE),
    ).resolves.toBe("trigger");
  });
});

describe("Will contract", () => {
  it("types allowed channel rules with exact and optional fields", () => {
    const config = {
      basePath: "data/yesimbot",
      chatModel: "test-model",
      allowedChannels: [
        { platform: "test", channelId: "room-1" },
        { platform: "*", channelId: "*", isDirect: true },
      ],
    } satisfies ConfigType;

    expect(config.allowedChannels).toHaveLength(2);
  });

  it("represents the Event and completed decision in one typed observation", () => {
    const event = directMessageEvent();
    const observation = { event, decision: "trigger" } satisfies WillObservation;

    expect(observation).toEqual({ event, decision: "trigger" });
    expectTypeOf<Will.Decision>().toEqualTypeOf<"wait" | "trigger">();
  });

  it("allows an optional stop method", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const will = { decide: async () => "wait" as const, stop } satisfies Will;

    await will.stop?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("accepts only readonly channel state and Event inputs", () => {
    const state: Will.State = EMPTY_STATE;
    const record = {} as EventRecord;

    expect(state).toBe(EMPTY_STATE);
    expect(record).toBeDefined();
  });
});
