import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { EventRecord } from "../src/event/index.js";
import { Gateway } from "../src/gateway/index.js";
import { ChannelStorage } from "../src/storage/index.js";

function session(send = vi.fn(async () => ["receipt-1"])) {
  return {
    platform: "test",
    selfId: "bot-1",
    channelId: "room-1",
    isDirect: false,
    type: "message-created",
    userId: "user-1",
    messageId: "message-1",
    timestamp: 1,
    event: { type: "message" },
    elements: "hello",
    send,
  };
}

function record(): EventRecord<"message"> {
  return {
    type: "message",
    platform: "test",
    selfId: "bot-1",
    timestamp: 1,
    channel: { id: "room-1", type: 0 },
    user: { id: "user-1" },
    message: { id: "message-1", content: "hello" },
    content: "hello",
  } as EventRecord<"message">;
}

function outputs(...content: string[]) {
  return (async function* () {
    for (const [index, value] of content.entries()) {
      yield { turnId: "turn-1", messageId: `assistant-${index + 1}`, content: value };
    }
  })();
}

function delivery() {
  return { fail: vi.fn(async () => ({ kind: "wait" as const, eventId: "failure-1" })), release: vi.fn() };
}

function createGateway(route: ReturnType<typeof vi.fn>, logger = { warn: vi.fn() }) {
  const ctx = {
    middleware: vi.fn(() => vi.fn()),
    on: vi.fn(() => vi.fn()),
    database: { get: vi.fn(async () => [{ assignee: "bot-1" }]) },
  };
  const storage = new ChannelStorage("/tmp/yesimbot-gateway-delivery-test");
  return {
    gateway: new Gateway({
      ctx: ctx as never,
      runtime: { route } as never,
      assets: { put: vi.fn() },
      storage,
      ready: () => storage.start(),
      logger,
    }),
    logger,
  };
}

describe("Gateway passive delivery", () => {
  it("sends complete outputs in yield order and accepts empty receipts", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const send = vi.fn().mockResolvedValueOnce(["receipt-1"]).mockResolvedValueOnce([]);
    const { gateway } = createGateway(route);

    await gateway.handle(session(send) as never);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(binding.release).toHaveBeenCalledOnce();
  });

  it("continues later outputs and persists one normalized failure through the bound delivery", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const offline = Object.assign(new Error("offline"), { code: "ECONNRESET" });
    const send = vi.fn().mockRejectedValueOnce(offline).mockResolvedValueOnce(["receipt-2"]);
    const { gateway } = createGateway(route);

    await gateway.handle(session(send) as never);

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(binding.fail.mock.calls[0]?.[0]).toMatchObject({
      type: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1" },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        error: { name: "Error", message: "offline", code: "ECONNRESET" },
      },
      content: expect.stringContaining("offline"),
    });
  });

  it("does not recursively route delivery-failure completion output", async () => {
    const binding = delivery();
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first"),
      delivery: binding,
    }));
    const send = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const { gateway } = createGateway(route);

    await gateway.handle(session(send) as never);

    expect(send).toHaveBeenCalledTimes(1);
    expect(route).toHaveBeenCalledOnce();
    expect(binding.fail).toHaveBeenCalledOnce();
  });

  it("keeps consuming later outputs when bound failure diagnostics fail", async () => {
    const binding = delivery();
    binding.fail.mockRejectedValueOnce(new Error("history unavailable"));
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: outputs("first", "second"),
      delivery: binding,
    }));
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    const { gateway } = createGateway(route, {
      warn: vi.fn(() => {
        throw new Error("logger unavailable");
      }),
    });

    await expect(gateway.handle(session(send) as never)).resolves.toBeUndefined();

    expect(send).toHaveBeenNthCalledWith(1, "first");
    expect(send).toHaveBeenNthCalledWith(2, "second");
    expect(route).toHaveBeenCalledOnce();
    expect(binding.release).toHaveBeenCalledOnce();
  });

  it("retains the originating Session only while consuming its active output", async () => {
    let release!: () => void;
    const finished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = vi.fn(async () => ({
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield { turnId: "turn-1", messageId: "assistant-1", content: "first" };
        await finished;
      })(),
      delivery: delivery(),
    }));
    const send = vi.fn(async () => []);
    const { gateway } = createGateway(route);
    const handling = gateway.handle(session(send) as never);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith("first"));
    let drained = false;
    const draining = gateway.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await handling;
    await draining;
    expect(drained).toBe(true);
  });
});
