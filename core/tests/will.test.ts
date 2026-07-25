import type { Universal } from "koishi";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { Config as ConfigType } from "../src/config.js";
import { createEvent, type Event, type EventRecord } from "../src/event/index.js";
import {
  DefaultWill,
  createWillingnessConfig,
  type DefaultWillConfig,
  WillingnessWill,
  type WillingnessConfig,
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
  readonly content?: string;
}): Event<"message"> {
  return createEvent({
    id: "event-1",
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: options.channelType },
    user: { id: "user-1" },
    message: { id: "message-1", content: options.content, elements: options.elements },
    content: options.content,
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

function quotedGroupMessageEvent(): Event<"message"> {
  return createEvent({
    id: "event-quote",
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: 0 },
    user: { id: "user-1" },
    message: {
      id: "message-quote",
      content: "quoted",
      quote: { user: { id: "bot-1" } },
    },
    content: "quoted",
  } as EventRecord<"message">);
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

const willingnessConfig: WillingnessConfig = {
  base: { text: 12 },
  attribute: { atMention: 100, isDirectMessage: 40 },
  interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
  lifecycle: {
    maxWillingness: 100,
    decayHalfLifeSeconds: 600,
    probabilityThreshold: 55,
    probabilityAmplifier: 0.04,
    replyCost: 35,
  },
};

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

describe("WillingnessWill", () => {
  it("applies the v3 dynamic gain curve before sampling", async () => {
    const will = new WillingnessWill({
      config: {
        ...willingnessConfig,
        base: { text: 20 },
        lifecycle: { ...willingnessConfig.lifecycle, probabilityThreshold: 30, probabilityAmplifier: 0.1 },
      },
      now: () => 1_000,
      random: () => 0.95,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("adds self-mention and direct bonuses from frozen message data", async () => {
    const mention = new WillingnessWill({
      config: { ...willingnessConfig, base: { text: 0 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    const direct = new WillingnessWill({
      config: { ...willingnessConfig, base: { text: 20 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(mention.decide(mentionedGroupEvent(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(direct.decide(directMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("uses keyword or default multipliers", async () => {
    const keyword = new WillingnessWill({
      config: {
        ...willingnessConfig,
        base: { text: 40 },
        interest: { keywords: ["yes"], keywordMultiplier: 1.5, defaultMultiplier: 1 },
      },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    const plain = new WillingnessWill({
      config: { ...willingnessConfig, base: { text: 40 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(
      keyword.decide(messageEvent({ channelType: 0, content: "yes" }), EMPTY_STATE),
    ).resolves.toBe("trigger");
    await expect(plain.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("does not award a bonus for quote elements", async () => {
    const will = new WillingnessWill({
      config: {
        ...willingnessConfig,
        base: { text: 40 },
        lifecycle: { ...willingnessConfig.lifecycle, probabilityThreshold: 50, probabilityAmplifier: 0.1 },
      },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(will.decide(quotedGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("clamps the score and probability at their maximums", async () => {
    const will = new WillingnessWill({
      config: {
        ...willingnessConfig,
        base: { text: 1_000 },
        lifecycle: { ...willingnessConfig.lifecycle, probabilityThreshold: 99, probabilityAmplifier: 1 },
      },
      now: () => 1_000,
      random: () => 0.999,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("waits without sampling or changing state for non-message events", async () => {
    const random = vi.fn(() => 0);
    const will = new WillingnessWill({ config: willingnessConfig, now: () => 1_000, random, warn: vi.fn() });

    await expect(will.decide(nonMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    expect(random).not.toHaveBeenCalled();
    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("fails closed and reports calculation failures without retaining partial state", async () => {
    const warn = vi.fn();
    const will = new WillingnessWill({
      config: willingnessConfig,
      now: () => {
        throw new Error("clock unavailable");
      },
      random: () => 0,
      warn,
    });

    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    expect(warn).toHaveBeenCalledWith(
      "will.willingness.calculation_failed",
      expect.objectContaining({ cause: "clock unavailable" }),
    );
  });

  it("does not retain score when random sampling fails", async () => {
    const random = vi.fn<() => number>()
      .mockImplementationOnce(() => {
        throw new Error("random unavailable");
      })
      .mockReturnValue(0.9);
    const will = new WillingnessWill({
      config: {
        ...willingnessConfig,
        base: { text: 20 },
        lifecycle: { ...willingnessConfig.lifecycle, probabilityThreshold: 30, probabilityAmplifier: 0.1 },
      },
      now: () => 1_000,
      random,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("snapshots nested configuration at construction", async () => {
    const config = {
      base: { text: 100 },
      attribute: { atMention: 100, isDirectMessage: 40 },
      interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
      lifecycle: {
        maxWillingness: 100,
        decayHalfLifeSeconds: 600,
        probabilityThreshold: 55,
        probabilityAmplifier: 0.04,
        replyCost: 35,
      },
    };
    const will = new WillingnessWill({ config, now: () => 1_000, random: () => 0, warn: vi.fn() });
    config.base.text = 0;

    await expect(will.decide(ordinaryGroupMessageEvent(), EMPTY_STATE)).resolves.toBe("trigger");
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

  it("keeps routing compatible while allowing a static willingness engine", () => {
    const config = {
      basePath: "data/yesimbot",
      chatModel: "test-model",
      will: { engine: "willingness", group: "trigger", base: { text: 12 } },
    } satisfies ConfigType;

    expect(config.will?.engine).toBe("willingness");
    expect(config.will?.group).toBe("trigger");
  });

  it("uses the v3 static willingness defaults without quote configuration", () => {
    expect(createWillingnessConfig()).toEqual({
      base: { text: 12 },
      attribute: { atMention: 100, isDirectMessage: 40 },
      interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1 },
      lifecycle: {
        maxWillingness: 100,
        decayHalfLifeSeconds: 600,
        probabilityThreshold: 55,
        probabilityAmplifier: 0.04,
        replyCost: 35,
      },
    });
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
