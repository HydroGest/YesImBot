import { describe, expect, it } from "vitest";

import { buildPromptBlock, escapePromptText, estimateTokens } from "../src/projector.js";
import type { ChatLearningConfig, ChatLearningState, GlobalChainPattern, GlobalPattern, MessageLink, MessageTurn } from "../src/types.js";

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
  observeAllChannels: false,
  globalRulePath: undefined,
  globalSyncIntervalMinutes: 60,
  minGlobalChannels: 2,
  maxGlobalPatterns: 3,
  summaryModel: undefined,
  embeddingModel: undefined,
  embeddingSimilarity: 0.92,
  maxModelThreads: 3,
  maxModelThreadMessages: 30,
  reflectionModel: undefined,
  maxInjectedReflections: 3,
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
  const historical = [turn("h1", "h1", 100, "历史消息"), turn("h2", "h2", 200, "历史回应")];
  const turns = [...historical, turn("t1", "m1", 1000, "这个方案靠谱吗"), turn("t2", "m2", 2000, "确实")];
  const links: MessageLink[] = [
    { from: "h2", to: "h1", kind: "reply", confidence: 1, evidence: ["quote"] },
    { from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: ["quote"] },
  ];
  return {
    lastEntryId: "t2",
    builtAt: 3000,
    turns,
    links,
    segments: [
      { id: "s0", startTime: 100, endTime: 200, turns: historical },
      { id: "s1", startTime: 1000, endTime: 2000, turns },
    ],
    responsePatterns: [{ intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["t2"] }],
    initiationPatterns: [{ intent: "question", phrase: "有人试过吗", frequency: 1, sampleIds: ["t1"] }],
  };
}

describe("buildPromptBlock", () => {
  it("injects links, patterns and examples within budget", () => {
    const block = buildPromptBlock(state(), undefined, config);

    expect(block).toBeDefined();
    expect(block).not.toContain("<message_links>");
    expect(block).not.toContain("<active_chain>");
    expect(block).toContain("<chat_learning_guide>");
    expect(block).toContain("风格样本");
    expect(block).toContain("模仿样本中的表达节奏");
    expect(block).toContain("<local_patterns>");
    expect(block).toContain('<style_examples historical="true">');
    expect(block).toContain('chain="h1 -&gt; h2"');
    expect(estimateTokens(block!)).toBeLessThanOrEqual(config.maxPromptTokens);
  });

  it("injects initiation patterns for proactive events", () => {
    const block = buildPromptBlock(state(), "global-brain", config);

    expect(block).not.toContain("<event_context>");
    expect(block).toContain('kind="initiation"');
  });

  it("injects cross-group global patterns when they pass the channel threshold", () => {
    const globalPatterns: GlobalPattern[] = [
      {
        kind: "response",
        intent: "agree",
        phrase: "确实",
        channels: [
          { key: "a", frequency: 3, lastSeenAt: 1 },
          { key: "b", frequency: 2, lastSeenAt: 1 },
        ],
        firstSeenAt: 1,
        lastSeenAt: 1,
      },
    ];

    const block = buildPromptBlock(state(), undefined, config, globalPatterns);

    expect(block).toContain("<global_patterns>");
    expect(block).toContain('kind="global:response"');
  });

  it("injects cross-group chain structures", () => {
    const globalChains: GlobalChainPattern[] = [
      {
        chain: ["question", "agree"],
        channels: [
          { key: "a", frequency: 2, lastSeenAt: 1 },
          { key: "b", frequency: 1, lastSeenAt: 1 },
        ],
        firstSeenAt: 1,
        lastSeenAt: 1,
      },
    ];

    const block = buildPromptBlock(state(), undefined, config, [], globalChains);

    expect(block).toContain("<global_chains>");
    expect(block).toContain('steps="question -&gt; agree"');
  });

  it("shows global content even when there is no local state", () => {
    const globalPatterns: GlobalPattern[] = [
      {
        kind: "response",
        intent: "agree",
        phrase: "确实",
        channels: [
          { key: "a", frequency: 2, lastSeenAt: 1 },
          { key: "b", frequency: 1, lastSeenAt: 1 },
        ],
        firstSeenAt: 1,
        lastSeenAt: 1,
      },
    ];

    const block = buildPromptBlock(undefined, undefined, config, globalPatterns, []);

    expect(block).toContain("<global_patterns>");
    expect(block).toContain('kind="global:response"');
  });

  it("escapes prompt tags for chat preview output", () => {
    expect(escapePromptText("<message_links>\n<edge/></message_links>")).toBe("&lt;message_links&gt;\n&lt;edge/&gt;&lt;/message_links&gt;");
  });
});
