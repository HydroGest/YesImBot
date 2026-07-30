import { type Universal } from "koishi";
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
  WillingnessWillEngine,
  type WillingnessConfig,
  type WillEngine,
  type WillEngineObservation,
} from "../src/runtime/will.js";

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
  probabilityThreshold: 55,
  decayHalfLifeSeconds: 600,
  replyCost: 35,
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
    await expect(
      new RoutingWillEngine().decide(ordinaryGroupMessageInput(), EMPTY_STATE),
    ).resolves.toBe("wait");
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
      config: { probabilityThreshold: 100, decayHalfLifeSeconds: 10, replyCost: 35 },
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
          config: { ...willingnessConfig, probabilityThreshold: Number.NaN },
        }),
    ).toThrow("Invalid willingness configuration");
    expect(
      () =>
        new WillingnessWillEngine({
          ...options,
          config: { ...willingnessConfig, replyCost: -1 },
        }),
    ).toThrow("Invalid willingness configuration");
    expect(
      () =>
        new WillingnessWillEngine({
          ...options,
          config: { ...willingnessConfig, decayHalfLifeSeconds: 0 },
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
        probabilityThreshold: 20,
      },
      now: () => 1_000,
      random: () => 0.1,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("adds self-mention and direct bonuses from frozen message data", async () => {
    const mention = new WillingnessWillEngine({
      config: { ...willingnessConfig, probabilityThreshold: 40 },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });
    const direct = new WillingnessWillEngine({
      config: { ...willingnessConfig, probabilityThreshold: 40 },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(mention.decide(mentionedGroupInput(), EMPTY_STATE)).resolves.toBe("trigger");
    await expect(direct.decide(directMessageInput(), EMPTY_STATE)).resolves.toBe("trigger");
  });

  it("clamps the score and probability at their maximums", async () => {
    const will = new WillingnessWillEngine({
      config: { ...willingnessConfig, probabilityThreshold: 99 },
      now: () => 1_000,
      random: () => 0,
      warn: vi.fn(),
    });

    await expect(will.decide(mentionedGroupInput(), EMPTY_STATE)).resolves.toBe("trigger");
    expect(will["score"]).toBe(100);
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
      .mockReturnValue(0.2);
    const will = new WillingnessWillEngine({
      config: { ...willingnessConfig, probabilityThreshold: 10 },
      now: () => 1_000,
      random,
      warn: vi.fn(),
    });

    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
    await expect(will.decide(ordinaryGroupMessageInput(), EMPTY_STATE)).resolves.toBe("wait");
  });
});

describe("Will contract", () => {
  it("materializes the routing defaults through the Config schema", () => {
    expect(Config({ basePath: "data/yesimbot", chatModel: "test-model" }).will).toEqual({
      engine: "routing",
      direct: "trigger",
      mention: "trigger",
      group: "wait",
    });
  });

  it("materializes willingness defaults through the Config schema", () => {
    expect(
      Config({
        basePath: "data/yesimbot",
        chatModel: "test-model",
        will: { engine: "willingness" },
      }).will,
    ).toEqual({
      engine: "willingness",
      probabilityThreshold: 55,
      decayHalfLifeSeconds: 600,
      replyCost: 35,
    });
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

  it("distinguishes routing from willingness configuration", () => {
    const config = {
      basePath: "data/yesimbot",
      chatModel: "test-model",
      will: { engine: "willingness", probabilityThreshold: 60 },
    } satisfies ConfigType;

    expect(config.will?.engine).toBe("willingness");
    expect(config.will?.probabilityThreshold).toBe(60);
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
