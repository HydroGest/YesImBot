import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedMany: vi.fn<() => Promise<{ embeddings: number[][] }>>(),
}));

vi.mock("ai", () => ({
  embedMany: mocks.embedMany,
}));

import { buildPatternEmbeddingMap, cosineSimilarity } from "../src/embedding.js";
import type { ChatLearningConfig, ResponsePattern } from "../src/types.js";

const config: ChatLearningConfig = {
  maxExamples: 4,
  maxMessagesPerExample: 5,
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
  maxGlobalPatterns: 8,
  summaryModel: undefined,
  embeddingModel: "openai:text-embedding-3-small",
  embeddingSimilarity: 0.92,
  maxModelThreads: 3,
  maxModelThreadMessages: 30,
  reflectionModel: undefined,
};

afterEach(() => {
  mocks.embedMany.mockReset();
});

describe("embedding", () => {
  it("builds a pattern embedding map in response and initiation order", async () => {
    const response: ResponsePattern = { intent: "agree", phrase: "确实", frequency: 1, sampleIds: ["m1"] };
    mocks.embedMany.mockResolvedValue({
      embeddings: [[1, 0, 0], [0, 1, 0]],
    });

    const map = await buildPatternEmbeddingMap(
      {
        logger: () => ({ warn: vi.fn<() => void>() }),
        yesimbot: { model: { resolveEmbedding: () => ({}) } },
      } as never,
      config,
      [response],
      [],
    );

    expect(map.get("response:agree:确实")).toEqual([1, 0, 0]);
    expect(mocks.embedMany).toHaveBeenCalledWith(
      expect.objectContaining({ model: {}, values: ["确实"], maxRetries: 0 }),
    );
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});
