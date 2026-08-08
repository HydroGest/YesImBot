import { describe, expect, it } from "vitest";

import { extractPatterns } from "../src/patterns.js";
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

describe("extractPatterns", () => {
  it("extracts response phrases from adjacent turns", () => {
    const patterns = extractPatterns([segment("s1", [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实")])]);

    expect(patterns.responsePatterns).toContainEqual(
      expect.objectContaining({ intent: "agree", phrase: "确实", frequency: 1 }),
    );
  });

  it("extracts initiation phrases from a new conversation segment", () => {
    const patterns = extractPatterns([segment("s1", [turn("m1", 1000, "有人试过新版本吗"), turn("m2", 2000, "试了")])]);

    expect(patterns.initiationPatterns).toContainEqual(
      expect.objectContaining({ intent: "question", phrase: "有人试过新版本吗" }),
    );
  });
});
