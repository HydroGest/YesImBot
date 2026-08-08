import { describe, expect, it } from "vitest";

import { buildLinks } from "../src/links.js";
import type { MessageTurn } from "../src/types.js";

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

    expect(links).toContainEqual({
      from: "t2",
      to: "t1",
      kind: "reply",
      confidence: 1,
      evidence: ["platform:reply", "target:m1"],
    });
  });

  it("builds low-confidence adjacent links", () => {
    const turns = [turn("t1", "m1", 1000, "第一条"), turn("t2", "m2", 5000, "第二条")];

    const links = buildLinks(turns);

    expect(links).toContainEqual(expect.objectContaining({ from: "t2", to: "t1", kind: "adjacent", confidence: 0.35 }));
  });

  it("marks direct mentions of the bot", () => {
    const turns = [
      {
        ...turn("t1", "m1", 1000, "你好"),
        mentionIds: ["bot-1"],
      },
    ];

    const links = buildLinks(turns, { selfId: "bot-1" });

    expect(links).toContainEqual(expect.objectContaining({ from: "t1", to: null, kind: "at", confidence: 1 }));
  });
});
