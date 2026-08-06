import type { Universal } from "koishi";
import { createMessage, type Event, type Message } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { PolicyRoutingEngine } from "../src/routing.js";
import { defaultRoutingConfig } from "../src/types.js";

function message(elements: unknown[], channelType = 0 as Universal.Channel.Type): Message {
  return createMessage({
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: channelType },
    user: { id: "user-1" },
    messageId: "m-1",
    elements: elements as never,
  });
}

function pokeEvent(): Event {
  return {
    id: "event-1",
    timestamp: 1,
    role: "custom",
    type: "yesimbot.event",
    data: {
      eventType: "notice.poke",
      platform: "test",
      selfId: "bot-1",
      timestamp: 1,
      channel: { id: "room-1", type: 0 },
      targetId: "user-1",
      action: "拍了拍",
      text: "user-1 拍了拍 bot-1",
    },
  };
}

const state = { activeTurnId: null };

describe("PolicyRoutingEngine", () => {
  it("routes direct, mention, all, here, quote, image, poke and group independently", async () => {
    const engine = new PolicyRoutingEngine({
      ...defaultRoutingConfig(),
      direct: "trigger",
      mention: "trigger",
      mentionAll: "wait",
      mentionHere: "wait",
      quote: "trigger",
      image: "trigger",
      poke: "trigger",
      group: "wait",
    });

    await expect(engine.decide(message([], 1), state)).resolves.toBe("trigger");
    await expect(engine.decide(message([{ type: "at", attrs: { id: "bot-1" }, children: [] }]), state)).resolves.toBe(
      "trigger",
    );
    await expect(engine.decide(message([{ type: "at", attrs: { type: "all" }, children: [] }]), state)).resolves.toBe(
      "wait",
    );
    await expect(engine.decide(message([{ type: "at", attrs: { type: "here" }, children: [] }]), state)).resolves.toBe(
      "wait",
    );
    await expect(engine.decide(message([{ type: "quote", attrs: { id: "q-1" }, children: [] }]), state)).resolves.toBe(
      "trigger",
    );
    await expect(
      engine.decide(message([{ type: "img", attrs: { id: "asset-1" }, children: [] }]), state),
    ).resolves.toBe("trigger");
    await expect(engine.decide(pokeEvent(), state)).resolves.toBe("trigger");
    await expect(
      engine.decide(message([{ type: "text", attrs: { content: "hi" }, children: [] }]), state),
    ).resolves.toBe("wait");
  });
});
