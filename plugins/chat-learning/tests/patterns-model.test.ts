import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn<() => Promise<{ text: string }>>(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

import { classifyPatternsWithModel } from "../src/patterns.js";
import type { ConversationSegment, MessageTurn } from "../src/types.js";

function turn(id: string, timestamp: number, text: string): MessageTurn {
  return {
    id,
    messageId: id,
    userId: "u1",
    userName: "A",
    timestamp,
    text,
    elementKinds: ["text"],
    hasImage: false,
    quoteId: undefined,
    quoteType: undefined,
    mentionIds: [],
  };
}

function segment(id: string, turns: readonly MessageTurn[]): ConversationSegment {
  return {
    id,
    startTime: turns[0]?.timestamp ?? 0,
    endTime: turns.at(-1)?.timestamp ?? 0,
    turns,
  };
}

afterEach(() => {
  mocks.generateText.mockReset();
});

describe("classifyPatternsWithModel", () => {
  it("uses model intents instead of deterministic regex", async () => {
    const turns = [
      turn("m1", 1000, "这个方案靠谱吗"),
      turn("m2", 2000, "确实"),
      turn("m3", 3000, "笑死"),
      turn("m4", 4000, "确实"),
    ];
    const segments = [segment("s1", turns)];
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        responsePatterns: [{ phrase: "确实", intent: "agree" }],
        initiationPatterns: [{ phrase: "这个方案靠谱吗", intent: "question" }],
      }),
    });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments);

    expect(patterns?.responsePatterns).toContainEqual(expect.objectContaining({ phrase: "确实", intent: "agree" }));
    expect(patterns?.initiationPatterns).toContainEqual(
      expect.objectContaining({ phrase: "这个方案靠谱吗", intent: "question" }),
    );
  });

  it("returns undefined when the model output is empty", async () => {
    const turns = [
      turn("m1", 1000, "这个方案靠谱吗"),
      turn("m2", 2000, "确实"),
      turn("m3", 3000, "笑死"),
      turn("m4", 4000, "确实"),
    ];
    const segments = [segment("s1", turns)];
    mocks.generateText.mockResolvedValue({ text: "{}" });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments);

    expect(patterns).toBeUndefined();
  });
});
