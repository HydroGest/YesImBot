import { h, type Universal } from "koishi";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Config } from "../src/config.js";
import type { Config as ConfigType } from "../src/config.js";
import {
  createInput,
  type Event,
  type EventRecord,
  type Input,
  type Message,
  type MessageRecord,
} from "../src/input.js";
import {
  RoutingWillEngine,
  createWillEngine,
  createWillingnessConfig,
  type DefaultWillConfig,
  WillingnessWillEngine,
  type WillingnessConfig,
  type WillEngine,
  type WillEngineObservation,
} from "../src/will/index.js";

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "test.notice": {
      channel: { id: string };
      notice: { value: string };
    };
  }
}

const EMPTY_STATE: WillEngine.State = {
  activeTurnId: null,
};

function messageInput(options: {
  readonly channelType: Universal.Channel.Type;
  readonly elements?: Universal.Message["elements"];
}): Message {
  return createInput({
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: options.channelType },
    user: { id: "user-1" },
    messageId: "message-1",
    elements: options.elements ?? [],
  });
}

function directMessageInput(): Message {
  return messageInput({ channelType: 1 });
}

function mentionedGroupInput(): Message {
  return messageInput({
    channelType: 0,
    elements: [{ type: "at", attrs: { id: "bot-1" }, children: [] }],
  });
}

function ordinaryGroupMessageInput(): Message {
  return messageInput({
    channelType: 0,
    elements: [{ type: "text", attrs: { content: "hello" }, children: [] }],
  });
}

function quotedGroupMessageInput(): Message {
  return createInput({
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: 0 },
    user: { id: "user-1" },
    messageId: "message-quote",
    elements: [{ type: "quote", attrs: { user: { id: "bot-1" } }, children: [] }],
  });
}

function nonMessageEvent(): Event<"test.notice"> {
  return createInput({
    eventType: "test.notice",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: 0 },
    notice: { value: "notice" },
    text: "notice",
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
  return createInput({
    eventType: "delivery.failed",
    platform: "test",
    selfId: "bot-1",
    timestamp: 123,
    channel: { id: "channel-1", type: 0 },
    delivery: {
      turnId: "turn-1",
      messageId: "message-1",
      segmentIndex: 1,
      segmentTotal: 1,
      error: { name: "Error", message: "offline" },
    },
    text: "Delivery failed",
  });
}

describe("RoutingWillEngine", () => {
  it("triggers direct messages and mentions but waits on ordinary group messages", async () => {
    const will = new RoutingWillEngine({ direct: "trigger", mention: "trigger", group: "wait" });

    await expect(will.decide(directMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(mentionedGroupInput(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("waits for non-message and delivery-failed events", async () => {
    const will = new RoutingWillEngine({ direct: "trigger", mention: "trigger", group: "trigger" });

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

    await expect(
      new RoutingWillEngine().decide(ordinaryGroupMessageInput(), EMPTY_STATE),
    ).resolves.toBe(defaultConfig.group);
    await expect(
      new RoutingWillEngine(config.will).decide(ordinaryGroupMessageInput(), EMPTY_STATE),
    ).resolves.toBe("trigger");
  });
});

describe("createWillEngine", () => {
  const diagnostics = {
    now: () => 1_000,
    random: () => 0,
    warn: vi.fn(),
  };

  it("creates distinct routing engines when selection is omitted", () => {
    const first = createWillEngine(undefined, diagnostics);
    const second = createWillEngine(undefined, diagnostics);

    expect(first).toBeInstanceOf(RoutingWillEngine);
    expect(second).toBeInstanceOf(RoutingWillEngine);
    expect(first).not.toBe(second);
  });

  it("creates a willingness engine when selected", () => {
    const will = createWillEngine({ engine: "willingness" }, diagnostics);

    expect(will).toBeInstanceOf(WillingnessWillEngine);
  });
});

describe("WillingnessWillEngine", () => {
  it("decays through public decisions without scheduling a timer", async () => {
    let now = 0;
    const will = new WillingnessWillEngine({
      config: createWillingnessConfig({
        base: { text: 10 },
        lifecycle: { probabilityThreshold: 100, decayHalfLifeSeconds: 10 },
      }),
      now: () => now,
      random: () => 1,
      warn: vi.fn(),
    });
    await will.decide(ordinaryGroupMessageInput(), EMPTY_STATE);
    now = 10_000;
    vi.useFakeTimers();

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("validates invalid configuration at construction", () => {
    const options = {
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    };

    expect(
      () =>
        new WillingnessWillEngine({
          ...options,
          config: createWillingnessConfig({ base: { text: Number.NaN } }),
        }),
    ).toThrow("Invalid willingness configuration");
    expect(
      () =>
        new WillingnessWillEngine({
          ...options,
          config: createWillingnessConfig({ lifecycle: { maxWillingness: 0 } }),
        }),
    ).toThrow("Invalid willingness configuration");
    expect(
      () =>
        new WillingnessWillEngine({
          ...options,
          config: createWillingnessConfig({ lifecycle: { decayHalfLifeSeconds: 0 } }),
        }),
    ).toThrow("Invalid willingness configuration");
  });

  it("charges reply cost with a zero floor", async () => {
    const will = new WillingnessWillEngine({
      config: willingnessConfig,
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    will["score"] = 50;

    await expect(will.onReply?.()).resolves.toBeUndefined();
    expect(will["score"]).toBe(15);

    await expect(will.onReply?.()).resolves.toBeUndefined();
    expect(will["score"]).toBe(0);
  });

  it("applies the v3 dynamic gain curve before sampling", async () => {
    const will = new WillingnessWillEngine({
      config: {
        ...willingnessConfig,
        base: { text: 20 },
        lifecycle: {
          ...willingnessConfig.lifecycle,
          probabilityThreshold: 30,
          probabilityAmplifier: 0.1,
        },
      },
      now: () => 1_000,
      random: () => 0.95,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("adds self-mention and direct bonuses from frozen message data", async () => {
    const mention = new WillingnessWillEngine({
      config: { ...willingnessConfig, base: { text: 0 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    const direct = new WillingnessWillEngine({
      config: { ...willingnessConfig, base: { text: 20 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(mention.decide(mentionedGroupInput(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(direct.decide(directMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("uses keyword or default multipliers", async () => {
    const keyword = new WillingnessWillEngine({
      config: {
        ...willingnessConfig,
        base: { text: 40 },
        interest: { keywords: ["yes"], keywordMultiplier: 1.5, defaultMultiplier: 1 },
      },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    const plain = new WillingnessWillEngine({
      config: { ...willingnessConfig, base: { text: 40 } },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(
      keyword.decide(messageInput({ channelType: 0, elements: [h.text("yes")] }), EMPTY_STATE),
    ).resolves.toBe("trigger");
    await expect(plain.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("does not award a bonus for quote elements", async () => {
    const will = new WillingnessWillEngine({
      config: {
        ...willingnessConfig,
        base: { text: 40 },
        lifecycle: {
          ...willingnessConfig.lifecycle,
          probabilityThreshold: 50,
          probabilityAmplifier: 0.1,
        },
      },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(will.decide(quotedGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("clamps the score and probability at their maximums", async () => {
    const will = new WillingnessWillEngine({
      config: {
        ...willingnessConfig,
        base: { text: 1_000 },
        lifecycle: {
          ...willingnessConfig.lifecycle,
          probabilityThreshold: 99,
          probabilityAmplifier: 1,
        },
      },
      now: () => 1_000,
      random: () => 0.999,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("waits without sampling or changing state for non-message events", async () => {
    const random = vi.fn(() => 0);
    const will = new WillingnessWillEngine({
      config: willingnessConfig,
      now: () => 1_000,
      random,
      warn: vi.fn(),
    });

    await expect(will.decide(nonMessageEvent(), EMPTY_STATE)).resolves.toBe("wait");
    expect(random).not.toHaveBeenCalled();
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
  });

  it("fails closed and reports calculation failures without retaining partial state", async () => {
    const warn = vi.fn();
    const will = new WillingnessWillEngine({
      config: willingnessConfig,
      now: () => {
        throw new Error("clock unavailable");
      },
      random: () => 0,
      warn,
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    expect(warn).toHaveBeenCalledWith(
      "will.willingness.calculation_failed",
      expect.objectContaining({ cause: "clock unavailable" }),
    );
  });

  it("does not retain score when random sampling fails", async () => {
    const random = vi
      .fn<() => number>()
      .mockImplementationOnce(() => {
        throw new Error("random unavailable");
      })
      .mockReturnValue(0.9);
    const will = new WillingnessWillEngine({
      config: {
        ...willingnessConfig,
        base: { text: 20 },
        lifecycle: {
          ...willingnessConfig.lifecycle,
          probabilityThreshold: 30,
          probabilityAmplifier: 0.1,
        },
      },
      now: () => 1_000,
      random,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
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
    const will = new WillingnessWillEngine({
      config,
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    config.base.text = 0;

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });
});

describe("Will contract", () => {
  it("materializes routing and static willingness defaults through the Config schema", () => {
    const config = Config({ basePath: "data/yesimbot", chatModel: "test-model" });

    expect(config.will).toEqual({
      engine: "routing",
      direct: "trigger",
      mention: "trigger",
      group: "wait",
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
    expect(config.will).not.toHaveProperty("attribute.quote");
  });

  it("preserves explicit routing overrides through the Config schema", () => {
    const config = Config({
      basePath: "data/yesimbot",
      chatModel: "test-model",
      will: { engine: "routing", direct: "wait", mention: "wait", group: "trigger" },
    });

    expect(config.will).toMatchObject({
      engine: "routing",
      direct: "wait",
      mention: "wait",
      group: "trigger",
    });
  });

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
    const event = directMessageInput();
    const observation = { event, decision: "trigger" } satisfies WillEngineObservation;

    expect(observation).toEqual({ event, decision: "trigger" });
    expectTypeOf<WillEngine.Decision>().toEqualTypeOf<"wait" | "trigger">();
  });

  it("allows an optional stop method", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const will = { decide: async () => "wait" as const, stop } satisfies WillEngine;

    await will.stop?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("accepts only readonly channel state and Input values", () => {
    const state: WillEngine.State = EMPTY_STATE;
    const input = messageInput({ channelType: 0 });

    expect(state).toBe(EMPTY_STATE);
    expectTypeOf(input).toEqualTypeOf<Input>();
    expectTypeOf<WillEngine.State>().toEqualTypeOf<{ readonly activeTurnId: string | null }>();
  });
});
