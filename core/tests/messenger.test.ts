import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Context, h } from "koishi";

import type { Config } from "../src/config.js";
import { Messenger } from "../src/messengers/index.js";
import type { EventRecord } from "../src/messages/index.js";

const config: Config = {
  basePath: "data/yesimbot",
  chatModel: "test:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  resourceReadTimeoutMs: 30_000,
  reply: {
    pacing: { charactersPerSecond: 100_000, maxTotalDelayMs: 60_000 },
    customInnerThought: false,
  },
  session: {
    compact: { threshold: 0.9, charTokenRatio: 1.8, minMessages: 20, maxFailures: 3, model: undefined },
    idle: { timeout: 0 },
  },
};

const event: EventRecord<"delivery.failed"> = {
  eventType: "delivery.failed",
  platform: "test",
  selfId: "bot-1",
  timestamp: 1,
  channel: { id: "room-1", type: 0 },
  text: "delivery failed",
  delivery: {
    turnId: "turn-1",
    messageId: "message-1",
    segmentIndex: 0,
    segmentTotal: 1,
    error: { name: "Error", message: "offline" },
  },
};

describe("Messenger", () => {
  it("routes an active post through its matching Bot and producing Runtime", async () => {
    const ctx = new Context();
    const exact = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
    const decoy = { platform: "test", selfId: "bot-2", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(decoy as never, exact as never);
    const runtime = { fail: vi.fn(async () => undefined) };
    const runtimes = {
      post: vi.fn(async () => ({
        kind: "run" as const,
        eventId: "event-1",
        output: (async function* () {
          yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
        })(),
        signal: new AbortController().signal,
      })),
    };

    const messenger = new Messenger(ctx, config, {} as never, runtimes as never);

    await messenger.post(event);

    expect(runtimes.post).toHaveBeenCalledWith(event, exact);
    expect(exact.sendMessage).toHaveBeenCalledWith("room-1", [h.text("reply")]);
    expect(decoy.sendMessage).not.toHaveBeenCalled();
    expect(runtime.fail).not.toHaveBeenCalled();
  });
});
