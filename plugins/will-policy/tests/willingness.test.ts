import type { Universal } from "koishi";
import { createMessage, type Event, type Message } from "koishi-plugin-yesimbot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { defaultWillingnessConfig } from "../src/types.js";
import { PolicyWillingnessEngine } from "../src/willingness.js";

const state = { activeTurnId: null };

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

describe("PolicyWillingnessEngine", () => {
  it("forces mention triggers when configured", async () => {
    const engine = new PolicyWillingnessEngine({
      ...defaultWillingnessConfig(),
      probabilityThreshold: 100,
      mentionForce: true,
    });

    await expect(engine.decide(message([{ type: "at", attrs: { id: "bot-1" }, children: [] }]), state)).resolves.toBe(
      "trigger",
    );
    expect(engine.getCurrentWillingness()).toBeGreaterThan(0);
  });

  it("samples probability from the willingness score", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.9);
    try {
      const engine = new PolicyWillingnessEngine({
        ...defaultWillingnessConfig(),
        probabilityThreshold: 0,
        textGain: 100,
        maxScore: 100,
      });

      await expect(engine.decide(message([]), state)).resolves.toBe("trigger");
    } finally {
      random.mockRestore();
    }
  });

  it("adds image gain when a message contains an image", async () => {
    const engine = new PolicyWillingnessEngine({
      ...defaultWillingnessConfig(),
      probabilityThreshold: 0,
      imageGain: 60,
      textGain: 0,
      maxScore: 100,
    });

    await expect(
      engine.decide(message([{ type: "img", attrs: { id: "asset-1" }, children: [] }]), state),
    ).resolves.toBe("trigger");
    expect(engine.getCurrentWillingness()).toBeGreaterThan(0);
  });

  it("adds poke gain for poke events", async () => {
    const engine = new PolicyWillingnessEngine({
      ...defaultWillingnessConfig(),
      probabilityThreshold: 0,
      pokeGain: 80,
      maxScore: 100,
    });

    await expect(engine.decide(pokeEvent(), state)).resolves.toBe("trigger");
    expect(engine.getCurrentWillingness()).toBeGreaterThan(0);
  });

  it("charges reply cost with a zero floor", async () => {
    const engine = new PolicyWillingnessEngine({
      ...defaultWillingnessConfig(),
      initialScore: 50,
      replyCost: 30,
    });

    await engine.onReply?.();
    expect(engine["score"]).toBe(20);

    await engine.onReply?.();
    expect(engine["score"]).toBe(0);
  });
});
