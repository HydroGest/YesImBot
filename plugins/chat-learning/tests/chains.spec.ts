import { describe, expect, it } from "vitest";

import { buildLocalChainPatterns } from "../src/chains.js";
import type { ConversationSegment, InitiationPattern, MessageLink, MessageTurn, ResponsePattern } from "../src/types.js";

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

function link(from: string, to: string): MessageLink {
  return { from, to, kind: "reply", confidence: 1, evidence: [] };
}

describe("buildLocalChainPatterns", () => {
  it("turns graph chains into intent sequences", () => {
    const turns = [turn("m1", 1000, "这个方案靠谱吗"), turn("m2", 2000, "确实"), turn("m3", 3000, "笑死")];
    const segments: ConversationSegment[] = [{ id: "s1", startTime: 1000, endTime: 3000, turns }];
    const links = [link("m2", "m1"), link("m3", "m2")];
    const responsePatterns: ResponsePattern[] = [
      { intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["m2"] },
      { intent: "joke", phrase: "笑死", frequency: 1, sampleIds: ["m3"] },
    ];
    const initiationPatterns: InitiationPattern[] = [{ intent: "question", phrase: "这个方案靠谱吗", frequency: 1, sampleIds: ["m1"] }];

    const chains = buildLocalChainPatterns(segments, links, responsePatterns, initiationPatterns);

    expect(chains).toMatchObject([{ chain: ["question", "agree", "joke"], frequency: 1 }]);
    expect(chains[0]?.sample?.turns.map((turn) => turn.text)).toEqual(["这个方案靠谱吗", "确实", "笑死"]);
  });

  it("skips chains with missing intent labels", () => {
    const turns = [turn("m1", 1000, "第一条"), turn("m2", 2000, "第二条")];
    const segments: ConversationSegment[] = [{ id: "s1", startTime: 1000, endTime: 2000, turns }];
    const links = [link("m2", "m1")];

    const chains = buildLocalChainPatterns(segments, links, [], []);

    expect(chains).toEqual([]);
  });
});
