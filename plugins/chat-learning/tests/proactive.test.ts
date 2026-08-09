import { createCustomMessage, createMessageEntry, type AgentEntry } from "@yesimbot/agent-runtime";
import { describe, expect, it } from "vitest";

import { detectProactiveEvent } from "../src/proactive.js";

function eventEntry(id: string, eventType: string, timestamp: number): AgentEntry {
  const message = createCustomMessage(
    "yesimbot.event",
    { platform: "test", selfId: "bot-1", channel: { id: "room-1", type: 0 }, eventType, text: "event" },
    { id: `${id}-event`, timestamp },
  );
  return createMessageEntry(message, { id, timestamp }) as unknown as AgentEntry;
}

describe("detectProactiveEvent", () => {
  it("detects global-brain events", () => {
    expect(detectProactiveEvent([eventEntry("e1", "global-brain.immediate", 1000)])).toBe("global-brain");
  });

  it("detects schedule events", () => {
    expect(detectProactiveEvent([eventEntry("e1", "schedule.due", 1000)])).toBe("schedule");
  });

  it("prefers the first known proactive event in a batch", () => {
    const entries = [eventEntry("e1", "delivery.failed", 1000), eventEntry("e2", "schedule.due", 2000)];

    expect(detectProactiveEvent(entries)).toBe("schedule");
  });

  it("returns undefined for unknown or non-event entries", () => {
    expect(detectProactiveEvent([eventEntry("e1", "delivery.failed", 1000)])).toBeUndefined();
    expect(detectProactiveEvent([])).toBeUndefined();
  });
});
