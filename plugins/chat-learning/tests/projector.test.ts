import { describe, expect, it } from "vitest";

import { buildPromptBlock, estimateTokens } from "../src/projector.js";
import type { ChatLearningConfig, ChatLearningState, MessageLink, MessageTurn } from "../src/types.js";

const config: ChatLearningConfig = {
  maxExamples: 2,
  maxMessagesPerExample: 3,
  maxHistoryAgeDays: 30,
  maxScanMessages: 1000,
  refreshIntervalMinutes: 30,
  maxPromptTokens: 2500,
  maskNames: true,
  blockedUserIds: [],
  blockedUserPatterns: [],
  autoBlockBotNames: false,
  summaryModel: undefined,
};

function turn(id: string, messageId: string, timestamp: number, text: string): MessageTurn {
  return {
    id,
    messageId,
    userId: "u1",
    userName: "Alice",
    timestamp,
    text,
    elementKinds: ["text"],
    hasImage: false,
    quoteId: undefined,
    quoteType: undefined,
    mentionIds: [],
  };
}

function state(): ChatLearningState {
  const turns = [turn("t1", "m1", 1000, "这个方案靠谱吗"), turn("t2", "m2", 2000, "确实")];
  const links: MessageLink[] = [{ from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: ["quote"] }];
  return {
    lastEntryId: "t2",
    builtAt: 3000,
    turns,
    links,
    segments: [
      {
        id: "s1",
        startTime: 1000,
        endTime: 2000,
        turns,
      },
    ],
    responsePatterns: [{ intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["t2"] }],
    initiationPatterns: [{ intent: "question", phrase: "有人试过吗", frequency: 1, sampleIds: ["t1"] }],
  };
}

describe("buildPromptBlock", () => {
  it("injects links, patterns and examples within budget", () => {
    const block = buildPromptBlock(state(), undefined, config);

    expect(block).toBeDefined();
    expect(block).toContain("<message_links>");
    expect(block).toContain("<local_patterns>");
    expect(block).toContain("<group_examples>");
    expect(estimateTokens(block!)).toBeLessThanOrEqual(config.maxPromptTokens);
  });

  it("injects initiation patterns for proactive events", () => {
    const block = buildPromptBlock(state(), "global-brain", config);

    expect(block).toContain("<event_context>");
    expect(block).toContain('kind="initiation"');
  });
});
