import { h } from "koishi";

import type { ChannelContext } from "../../src/channels/index.js";
import type { Config } from "../../src/config.js";
import type { EventRecord, MessageRecord } from "../../src/messages/index.js";

export const scope: ChannelContext = { type: "guild", platform: "onebot", channelId: "room-42", guildId: "room-42" };

export const otherScope: ChannelContext = { ...scope, channelId: "room-43", guildId: "room-43" };

export const testScope: ChannelContext = { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" };

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function defaultConfig(overrides: Partial<Config> = {}): Config {
  return {
    basePath: "data/yesimbot",
    chatModel: "test:model",
    visionModel: undefined,
    logLevel: 2,
    allowedChannels: [],
    imageInput: false,
    resourceReadTimeout: 30,
    will: { engine: "routing", direct: "trigger", mention: "trigger", group: "wait" },
    pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
    customInnerThought: true,
    wrapFinalReply: false,
    session: { compact: { responseIdleMinutes: 120, minMessages: 20, maxFailures: 3, model: undefined }, archive: { maxKB: 5 * 1024 } },
    ...overrides,
  };
}

export function deliveryFailedEvent(overrides: Partial<EventRecord<"delivery.failed">> = {}): EventRecord<"delivery.failed"> {
  return {
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    timestamp: 2,
    channel: { id: "room-1", type: 0 },
    delivery: { turnId: "turn-1", messageId: "assistant-1", segmentIndex: 1, segmentTotal: 1, error: { name: "Error", message: "offline" } },
    text: "Delivery failed",
    ...overrides,
  };
}

export function defaultMessageRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1", name: "User" },
    messageId: "message-1",
    elements: [h.text("hello")],
    ...overrides,
  };
}
