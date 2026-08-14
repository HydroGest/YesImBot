import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Context, h } from "koishi";

import type { Config } from "../src/config.js";
import type { EventRecord } from "../src/messages/index.js";
import { Messenger } from "../src/messengers/index.js";

const config: Config = {
  basePath: "data/yesimbot",
  chatModel: "test:model",
  visionModel: undefined,
  logLevel: 2,
  allowedChannels: [],
  imageInput: false,
  resourceReadTimeout: 30,
  pacing: { charactersPerSecond: 100_000, maxTotalDelayMs: 60_000 },
  customInnerThought: true,
  wrapFinalReply: false,
  session: { compact: { responseIdleMinutes: 0, minMessages: 20, maxFailures: 3, model: undefined }, archive: { maxKB: 0 } },
};

const event: EventRecord<"delivery.failed"> = {
  eventType: "delivery.failed",
  platform: "test",
  selfId: "bot-1",
  timestamp: 1,
  channel: { id: "room-1", type: 0 },
  text: "delivery failed",
  delivery: { turnId: "turn-1", messageId: "message-1", segmentIndex: 0, segmentTotal: 1, error: { name: "Error", message: "offline" } },
};

describe("Messenger", () => {
  it("routes an active post through its matching Bot and producing Runtime", async () => {
    const ctx = new Context();
    const exact = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
    const decoy = { platform: "test", selfId: "bot-2", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(decoy as never, exact as never);
    const runtime = {
      context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" },
      fail: vi.fn(async () => undefined),
      post: vi.fn(async () => ({
        kind: "run" as const,
        eventId: "event-1",
        output: (async function* () {
          yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
        })(),
        signal: new AbortController().signal,
      })),
    };
    const channels = { resolve: vi.fn(async () => ({ context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" } })) };
    const runtimes = { get: vi.fn(async () => runtime) };

    const messenger = new Messenger(ctx, config, channels as never, runtimes as never);

    await messenger.post(event);

    expect(runtimes.get).toHaveBeenCalledWith(expect.anything(), exact);
    expect(runtime.post).toHaveBeenCalledWith(event, { trigger: true, ifBusy: "defer" });
    expect(exact.sendMessage).toHaveBeenCalledWith("room-1", [h.text("reply")]);
    expect(decoy.sendMessage).not.toHaveBeenCalled();
    expect(runtime.fail).not.toHaveBeenCalled();
  });

  it("keeps the Session live through default translation and resource persistence", async () => {
    const ctx = new Context();
    const bot = { platform: "test", selfId: "bot-1", status: 1, sendMessage: vi.fn(async () => []) };
    ctx.bots.push(bot as never);
    Object.assign(ctx, { database: { get: vi.fn(async () => [{ assignee: "bot-1" }]) } });
    const put = vi.fn(async () => "0123456789abcdef0123456789abcdef");
    const resources = {
      assets: { put },
      persistElements: vi.fn(async (_ctx: unknown, elements: readonly { type: string; attrs: Record<string, unknown> }[]) =>
        elements.map((el) => (el.type === "img" ? h("img", { id: "0123456789abcdef0123456789abcdef" }) : el)),
      ),
    };
    const channel = { context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" }, resources };
    const runtime = { handle: vi.fn(async () => ({ kind: "wait" as const, eventId: "event-1" })) };
    const channels = { start: vi.fn(async () => undefined), resolve: vi.fn(async () => channel) };
    const runtimes = { get: vi.fn(async () => runtime) };
    const http = Object.assign(
      vi.fn(async () => ({
        data: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
            controller.close();
          },
        }),
      })),
      { head: vi.fn(async () => ({ get: (name: string) => ({ "content-type": "image/png", "content-length": "4" })[name] ?? null })) },
    );
    Object.assign(ctx, { http });
    const messenger = new Messenger(ctx, { ...config, allowedChannels: [{ platform: "test", channelId: "room-1" }] }, channels as never, runtimes as never);
    const session = {
      type: "message-created",
      platform: "test",
      selfId: "bot-1",
      channelId: "room-1",
      guildId: "room-1",
      userId: "user-1",
      timestamp: 1,
      messageId: "message-1",
      isDirect: false,
      event: { channel: { type: 0 }, user: { id: "user-1" } },
      elements: [h("img", { src: "https://example.test/image.png" })],
      send: vi.fn(async () => []),
    };

    await messenger["handle"](session as never);

    expect(resources.persistElements).toHaveBeenCalledOnce();
    expect(runtime.handle).toHaveBeenCalledWith(expect.objectContaining({ elements: [h("img", { id: "0123456789abcdef0123456789abcdef" })] }));
    expect(runtimes.get).toHaveBeenCalledWith(channel, bot, session);
  });

  it("feeds an active delivery rejection back to its producing Runtime", async () => {
    const ctx = new Context();
    const bot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => Promise.reject(new Error("offline"))) };
    ctx.bots.push(bot as never);
    const runtime = {
      context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" },
      fail: vi.fn(async () => undefined),
      post: vi.fn(async () => ({
        kind: "run" as const,
        eventId: "event-1",
        output: (async function* () {
          yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
        })(),
        signal: new AbortController().signal,
      })),
    };
    const channels = { resolve: vi.fn(async () => ({ context: runtime.context })) };
    const runtimes = { get: vi.fn(async () => runtime) };
    const messenger = new Messenger(ctx, { ...config, pacing: { charactersPerSecond: 8, maxTotalDelayMs: 1 } }, channels as never, runtimes as never);

    await messenger.post(event);

    expect(bot.sendMessage).toHaveBeenCalledOnce();
    expect(runtime.fail).toHaveBeenCalledWith("event-1", expect.objectContaining({ message: "offline" }), {
      turnId: "turn-1",
      messageId: "assistant-1",
      segmentIndex: 1,
      segmentTotal: 1,
    });
  });
  it("does not deliver a segment aborted during pacing delay", async () => {
    vi.useFakeTimers();
    try {
      const ctx = new Context();
      const controller = new AbortController();
      const bot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
      ctx.bots.push(bot as never);
      const runtime = {
        context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" },
        fail: vi.fn(async () => undefined),
        post: vi.fn(async () => ({
          kind: "run" as const,
          eventId: "event-1",
          output: (async function* () {
            yield { turnId: "turn-1", messageId: "assistant-1", segments: [[h.text("reply")]] };
          })(),
          signal: controller.signal,
        })),
      };
      const channels = { resolve: vi.fn(async () => ({ context: runtime.context })) };
      const runtimes = { get: vi.fn(async () => runtime) };
      const messenger = new Messenger(ctx, { ...config, pacing: { charactersPerSecond: 1, maxTotalDelayMs: 1_000 } }, channels as never, runtimes as never);

      const pending = messenger.post(event);
      for (let attempt = 0; attempt < 10 && vi.getTimerCount() === 0; attempt += 1) await Promise.resolve();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      controller.abort();
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(bot.sendMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an active post without a matching Bot before Runtime creation", async () => {
    const ctx = new Context();
    ctx.bots.push({ platform: "test", selfId: "other", sendMessage: vi.fn() } as never);
    const channels = { resolve: vi.fn() };
    const runtimes = { get: vi.fn() };
    const messenger = new Messenger(ctx, config, channels as never, runtimes as never);

    await expect(messenger.post(event)).rejects.toThrow("No Bot is available for test:bot-1");

    expect(channels.resolve).not.toHaveBeenCalled();
    expect(runtimes.get).not.toHaveBeenCalled();
  });
});
