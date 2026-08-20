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
  it("routes an active post through its matching Bot and awaits the producing Runtime turn", async () => {
    const ctx = new Context();
    const exact = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
    const decoy = { platform: "test", selfId: "bot-2", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(decoy as never, exact as never);
    let settled = false;
    const runtime = {
      context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" },
      post: vi.fn(async () => ({
        kind: "run" as const,
        eventId: "event-1",
        done: Promise.resolve().then(() => {
          settled = true;
        }),
      })),
    };
    const channels = { resolve: vi.fn(async () => ({ context: runtime.context })) };
    const runtimes = { get: vi.fn(async () => runtime) };

    const messenger = new Messenger(ctx, config, channels as never, runtimes as never);

    await messenger.post(event);

    expect(runtimes.get).toHaveBeenCalledWith(expect.anything(), exact);
    expect(runtime.post).toHaveBeenCalledWith(event, { trigger: true, ifBusy: "defer" });
    expect(settled).toBe(true);
    // Delivery now belongs to send_message inside the turn, so Messenger never touches the Bot.
    expect(exact.sendMessage).not.toHaveBeenCalled();
    expect(decoy.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards the silent delivery intent to the Runtime that enforces it", async () => {
    const ctx = new Context();
    const bot = { platform: "test", selfId: "bot-1", sendMessage: vi.fn(async () => []) };
    ctx.bots.push(bot as never);
    const runtime = {
      context: { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" },
      post: vi.fn(async () => ({ kind: "run" as const, eventId: "event-1", done: Promise.resolve() })),
    };
    const channels = { resolve: vi.fn(async () => ({ context: runtime.context })) };
    const runtimes = { get: vi.fn(async () => runtime) };
    const messenger = new Messenger(ctx, config, channels as never, runtimes as never);

    await messenger.post(event, { trigger: true, ifBusy: "defer", delivery: "silent" });

    expect(runtime.post).toHaveBeenCalledWith(event, { trigger: true, ifBusy: "defer", delivery: "silent" });
    expect(bot.sendMessage).not.toHaveBeenCalled();
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
