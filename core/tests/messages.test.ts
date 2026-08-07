import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));
import { h } from "koishi";

import { createEvent, createMessage, formatInput, isEvent, isMessage } from "../src/messages/index.js";

describe("messages", () => {
  it("projects immutable records to the fixed Core model format", () => {
    const message = createMessage({ platform: "test", selfId: "bot", timestamp: 1, channel: { id: "room", type: 0 }, user: { id: "user", name: "User" }, messageId: "m1", elements: [h.text("hello")] });
    expect(isMessage(message)).toBe(true);
    expect(formatInput(message).content).toContain("hello");
    const event = createEvent({ eventType: "delivery.failed", platform: "test", selfId: "bot", timestamp: 1, channel: { id: "room", type: 0 }, text: "failed", delivery: { turnId: "t", messageId: "m", segmentIndex: 0, segmentTotal: 1, error: { name: "Error", message: "x" } } });
    expect(isEvent(event)).toBe(true);
    expect(formatInput(event).content).toContain("SYSTEM_NOTIFICATION");
  });
});
