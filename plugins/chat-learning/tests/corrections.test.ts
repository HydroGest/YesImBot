import { describe, expect, it } from "vitest";

import { applyCorrections } from "../src/corrections.js";
import type { LinkCorrection, MessageLink, MessageTurn } from "../src/types.js";

function turn(id: string, messageId: string, timestamp: number, text: string): MessageTurn {
  return {
    id,
    messageId,
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

function correction(action: LinkCorrection["action"], from: string, to: string | null, kind: LinkCorrection["kind"] = "reply"): LinkCorrection {
  return { id: `${action}-${from}-${to}`, action, from, to, kind, confidence: 1, createdAt: 1, note: undefined };
}

describe("applyCorrections", () => {
  it("adds a manual link by message id", () => {
    const turns = [turn("t1", "m1", 1000, "原始"), turn("t2", "m2", 2000, "回应")];
    const links: MessageLink[] = [];

    const result = applyCorrections(links, turns, [correction("add", "m2", "m1", "reply")]);

    expect(result).toContainEqual(expect.objectContaining({ from: "t2", to: "t1", kind: "reply", confidence: 1 }));
  });

  it("removes an existing link and its auto-generated candidates", () => {
    const turns = [turn("t1", "m1", 1000, "原始"), turn("t2", "m2", 2000, "回应")];
    const links: MessageLink[] = [
      { from: "t2", to: "t1", kind: "reply", confidence: 1, evidence: ["platform"] },
      { from: "t2", to: "t1", kind: "adjacent", confidence: 0.35, evidence: ["time"] },
    ];

    const result = applyCorrections(links, turns, [correction("remove", "m2", "m1", "*")]);

    expect(result).toEqual([]);
  });
});
