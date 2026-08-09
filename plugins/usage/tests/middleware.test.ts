import { describe, expect, it } from "vitest";

import { normalizeLanguageUsage } from "../src/middleware.js";

describe("normalizeLanguageUsage", () => {
  it("normalizes AI SDK v3 usage details", () => {
    expect(
      normalizeLanguageUsage({ inputTokens: { total: 100, noCache: 40, cacheRead: 50, cacheWrite: 10 }, outputTokens: { total: 30, text: 20, reasoning: 10 } }),
    ).toEqual({ inputTokens: 100, outputTokens: 30, noCacheTokens: 40, cacheReadTokens: 50, cacheWriteTokens: 10 });
  });

  it("normalizes AI SDK v2 usage details", () => {
    expect(normalizeLanguageUsage({ inputTokens: 100, outputTokens: 30, cachedInputTokens: 70, reasoningTokens: 10 })).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      noCacheTokens: 30,
      cacheReadTokens: 70,
      cacheWriteTokens: 0,
    });
  });

  it("derives no-cache tokens from input totals when the field is missing", () => {
    expect(normalizeLanguageUsage({ inputTokens: { total: 100, cacheRead: 70 }, outputTokens: { total: 10 } })).toMatchObject({
      inputTokens: 100,
      noCacheTokens: 30,
      cacheReadTokens: 70,
    });
  });

  it("returns zeroes for missing usage", () => {
    expect(normalizeLanguageUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
