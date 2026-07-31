import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { deliverOutput } from "../src/delivery.js";
import type { MessageRecord } from "../src/messages.js";

function runResult(...content: string[]) {
  const delivery = {
    signal: new AbortController().signal,
    onDelivered: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
  return {
    result: {
      kind: "run" as const,
      eventId: "event-1",
      turnId: "turn-1",
      output: (async function* () {
        yield {
          turnId: "turn-1",
          messageId: "assistant-1",
          segments: content.map((text) => [h.text(text)]),
        };
      })(),
      delivery,
    },
    delivery,
  };
}

const record: MessageRecord = {
  platform: "test",
  selfId: "bot-1",
  timestamp: 1,
  channel: { id: "room-1", type: 0 },
  user: { id: "user-1" },
  messageId: "message-1",
  elements: [h.text("hello")],
};

describe("deliverOutput", () => {
  it("sends structured segments in produced order and acknowledges the first success", async () => {
    const { result, delivery } = runResult("first", "second");
    const send = vi.fn(async () => []);
    await deliverOutput({
      record,
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).toHaveBeenNthCalledWith(1, [h.text("first")]);
    expect(send).toHaveBeenNthCalledWith(2, [h.text("second")]);
    expect(delivery.onDelivered).toHaveBeenCalledOnce();
  });

  it("writes one delivery.failed feedback and stops after the first rejected send", async () => {
    const { result, delivery } = runResult("first", "second");
    const send = vi.fn().mockRejectedValueOnce(new Error("offline"));
    await deliverOutput({
      record,
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([h.text("first")]);
    expect(delivery.onDelivered).not.toHaveBeenCalled();
    expect(delivery.fail).toHaveBeenCalledOnce();
    expect(delivery.fail.mock.calls[0]?.[0]).toMatchObject({
      eventType: "delivery.failed",
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1" },
      delivery: {
        turnId: "turn-1",
        messageId: "assistant-1",
        segmentIndex: 1,
        segmentTotal: 2,
        error: { name: "Error", message: "offline" },
      },
      text: expect.stringContaining("offline"),
    });
  });

  it("does not send or fail when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { result, delivery } = runResult("first");
    result.delivery.signal = controller.signal;
    const send = vi.fn(async () => []);
    await deliverOutput({
      record,
      result,
      pacing: { charactersPerSecond: 8, maxTotalDelayMs: 60_000 },
      send,
      warn: vi.fn(),
    });
    expect(send).not.toHaveBeenCalled();
    expect(delivery.onDelivered).not.toHaveBeenCalled();
    expect(delivery.fail).not.toHaveBeenCalled();
  });

  it("paces one-character segments at the 250 ms minimum after the budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const { result, delivery } = runResult("a", "a");
      const send = vi.fn(async () => []);
      const delivering = deliverOutput({
        record,
        result,
        pacing: { charactersPerSecond: 10, maxTotalDelayMs: 150 },
        send,
        warn: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(249);
      expect(send).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await delivering;

      expect(send).toHaveBeenCalledTimes(2);
      expect(delivery.onDelivered).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
