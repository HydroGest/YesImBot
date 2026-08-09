import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateText: vi.fn<() => Promise<{ text: string }>>() }));

vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { classifyPatternsWithModel, generateChainSemantics } from "../src/patterns.js";
import type { ConversationSegment, MessageLink, MessageTurn } from "../src/types.js";

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
  return { id, startTime: turns[0]?.timestamp ?? 0, endTime: turns.at(-1)?.timestamp ?? 0, turns };
}

function replyLink(from: string, to: string): MessageLink {
  return { from, to, kind: "reply", confidence: 1, evidence: [] };
}

afterEach(() => {
  mocks.generateText.mockReset();
});

describe("classifyPatternsWithModel", () => {
  it("uses per-message model intents and aggregates real frequency", async () => {
    const turns = [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实"), turn("m3", 3000, "笑死"), turn("m4", 4000, "确实")];
    const segments = [segment("s1", turns)];
    const links = [replyLink("m2", "m1"), replyLink("m3", "m2"), replyLink("m4", "m3")];
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        messages: [
          { id: "t0-m0", role: "initiation", intent: "question" },
          { id: "t0-m1", role: "response", intent: "agree" },
          { id: "t0-m2", role: "response", intent: "joke" },
          { id: "t0-m3", role: "response", intent: "agree" },
        ],
      }),
    });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments, links);

    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("## conversation thread 0") }));
    expect(patterns?.responsePatterns).toContainEqual(expect.objectContaining({ phrase: "确实", intent: "agree", frequency: 2, sampleIds: ["m2", "m4"] }));
    expect(patterns?.responsePatterns).toContainEqual(expect.objectContaining({ phrase: "笑死", intent: "joke", frequency: 1, sampleIds: ["m3"] }));
    expect(patterns?.initiationPatterns).toContainEqual(
      expect.objectContaining({ phrase: "这个方案靠谱吗", intent: "question", frequency: 1, sampleIds: ["m1"] }),
    );
  });

  it("filters noise labels and unknown ids", async () => {
    const turns = [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实"), turn("m3", 3000, "机器人状态通知"), turn("m4", 4000, "确实")];
    const segments = [segment("s1", turns)];
    const links = [replyLink("m2", "m1"), replyLink("m3", "m2"), replyLink("m4", "m3")];
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        messages: [
          { id: "t0-m0", role: "noise", intent: "noise" },
          { id: "t0-m1", role: "noise", intent: "noise" },
          { id: "t0-m2", role: "noise", intent: "noise" },
          { id: "t0-m3", role: "response", intent: "agree" },
          { id: "unknown", role: "response", intent: "agree" },
        ],
      }),
    });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments, links);

    expect(patterns?.responsePatterns).toEqual([expect.objectContaining({ phrase: "确实", intent: "agree", frequency: 1, sampleIds: ["m4"] })]);
    expect(patterns?.initiationPatterns).toEqual([]);
  });

  it("returns undefined when the model output is empty", async () => {
    const turns = [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实"), turn("m3", 3000, "笑死"), turn("m4", 4000, "确实")];
    const segments = [segment("s1", turns)];
    const links = [replyLink("m2", "m1"), replyLink("m3", "m2"), replyLink("m4", "m3")];
    mocks.generateText.mockResolvedValue({ text: "{}" });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments, links);

    expect(patterns).toBeUndefined();
  });

  it("accepts explicit empty labels instead of falling back to regex", async () => {
    const turns = [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实"), turn("m3", 3000, "笑死"), turn("m4", 4000, "确实")];
    const segments = [segment("s1", turns)];
    const links = [replyLink("m2", "m1"), replyLink("m3", "m2"), replyLink("m4", "m3")];
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({ messages: [] }) });

    const patterns = await classifyPatternsWithModel({} as never, turns, segments, links);

    expect(patterns).toEqual({ responsePatterns: [], initiationPatterns: [] });
  });
});

describe("generateChainSemantics", () => {
  it("uses the model to describe a real global chain", async () => {
    mocks.generateText.mockResolvedValue({ text: "有人在分享时，群友通常短接一句认可。" });

    const semantics = await generateChainSemantics({} as never, ["share", "agree"], {
      turns: [
        { intent: "share", speaker: "A", text: "我的控制台全是这玩意" },
        { intent: "agree", speaker: "B", text: "我也是" },
      ],
    });

    expect(semantics).toBe("有人在分享时，群友通常短接一句认可。");
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("chain: share -> agree"),
      }),
    );
  });
});
