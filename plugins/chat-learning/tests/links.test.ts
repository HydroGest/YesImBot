import { describe, expect, it } from "vitest";

import { buildConversationChains, buildLinks, createMessageGraph, isGraphRelated } from "../src/links.js";
import type { MessageLink, MessageTurn } from "../src/types.js";

function turn(id: string, messageId: string, timestamp: number, text: string, quoteId?: string): MessageTurn {
  return {
    id,
    messageId,
    userId: "u1",
    userName: "A",
    timestamp,
    text,
    elementKinds: [],
    hasImage: false,
    quoteId,
    quoteType: quoteId ? "reply" : undefined,
    mentionIds: [],
  };
}

describe("buildLinks", () => {
  it("builds explicit quote links with confidence 1", () => {
    const turns = [turn("t1", "m1", 1000, "原始消息"), turn("t2", "m2", 2000, "回应", "m1")];

    const links = buildLinks(turns);

    expect(links).toContainEqual({ from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: ["platform:reply", "target:m1"] });
  });

  it("builds low-confidence adjacent links", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 5000, "第二条")];

    const links = buildLinks(turns);

    expect(links).toContainEqual(expect.objectContaining({ from: "t2", to: "t1", kind: "adjacent", confidence: 0.35 }));
  });

  it("marks direct mentions of the bot", () => {
    const turns = [{ ...turn("t1", "m1", 1000, "你好"), mentionIds: ["bot-1"] }];

    const links = buildLinks(turns, { selfId: "bot-1" });

    expect(links).toContainEqual(expect.objectContaining({ from: "t1", to: null, kind: "at", confidence: 1 }));
  });
});

describe("message graph", () => {
  it("connects turns through explicit reply chains", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 2000, "回应", "m1"), turn("t3", "m3", 3000, "再回应", "m2")];
    const links: MessageLink[] = [
      { from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: [] },
      { from: "t3", to: "t2", kind: "reply", confidence: 1, evidence: [] },
    ];

    const graph = createMessageGraph(turns, links);

    expect(isGraphRelated(graph, "t3", "t1")).toBe(true);
  });

  it("does not connect turns when only a low-confidence adjacent edge exists", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 5000, "第二条")];
    const links: MessageLink[] = [{ from: "t2", to: "t1", kind: "adjacent", confidence: 0.35, evidence: [] }];

    const graph = createMessageGraph(turns, links);

    expect(isGraphRelated(graph, "t2", "t1")).toBe(false);
  });

  it("treats entity overlap as a direct but soft relation", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 5000, "第二条")];
    const links: MessageLink[] = [{ from: "t2", to: "t1", kind: "entity", confidence: 0.5, evidence: [] }];

    const graph = createMessageGraph(turns, links);

    expect(isGraphRelated(graph, "t2", "t1")).toBe(true);
  });

  it("builds chronological conversation chains from direct reply links", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 2000, "回应", "m1"), turn("t3", "m3", 3000, "再回应", "m2")];
    const links: MessageLink[] = [
      { from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: [] },
      { from: "t3", to: "t2", kind: "reply", confidence: 1, evidence: [] },
    ];

    const chains = buildConversationChains([{ turns }], links);

    expect(chains[0]?.id).toBe("chain-t1-t3");
    expect(chains[0]?.turns.map((turn) => turn.id)).toEqual(["t1", "t2", "t3"]);
  });
});
