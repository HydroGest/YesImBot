import { describe, expect, it } from "vitest";

import { retentionScore, toMemoryRecall, type Memory } from "../src/types.js";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "memory-1",
    content: "Alice prefers tea",
    scope: "user",
    platform: "test",
    userId: "alice",
    importance: 0.8,
    confidence: 0.9,
    tags: ["preference"],
    status: "active",
    createdAt: 0,
    updatedAt: 60_000,
    lastAccessedAt: 0,
    accessCount: 3,
    ...overrides,
  };
}

describe("memory types", () => {
  it("projects a recall without source records or raw message ids", () => {
    expect(toMemoryRecall(memory(), 120_000, 2)).toEqual({
      id: "memory-1",
      content: "Alice prefers tea",
      scope: "user",
      importance: 0.8,
      confidence: 0.9,
      updatedAt: 60_000,
      relativeTime: "1 minute ago",
      evidenceCount: 2,
    });
  });

  it("decays by age and caps access frequency", () => {
    expect(retentionScore(memory({ importance: 0.8, lastAccessedAt: 0, accessCount: 0 }), 90 * 24 * 60 * 60 * 1_000, 90)).toBeCloseTo(0.4);
    expect(retentionScore(memory({ importance: 0.8, lastAccessedAt: 0, accessCount: 10_000 }), 0, 90)).toBeCloseTo(1.6);
  });
});
