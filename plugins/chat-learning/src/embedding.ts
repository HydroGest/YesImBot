import { embedMany, type EmbeddingModel } from "ai";
import type { Context } from "koishi";

import type { ModelCache } from "./model-cache.js";
import type { ChatLearningConfig, InitiationPattern, ResponsePattern } from "./types.js";

export function resolveEmbeddingModelId(config: ChatLearningConfig): string | undefined {
  return config.embeddingModel?.trim() || undefined;
}

export async function buildPatternEmbeddingMap(
  ctx: Context,
  config: ChatLearningConfig,
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
  cache?: ModelCache,
): Promise<ReadonlyMap<string, readonly number[]>> {
  const modelId = resolveEmbeddingModelId(config);
  if (!modelId) return new Map();
  const key = cache?.key(["embedding", modelId, responsePatterns, initiationPatterns]);
  const produce = async (): Promise<ReadonlyMap<string, readonly number[]>> => {
    let model: EmbeddingModel;
    try {
      model = ctx.yesimbot.model.resolveEmbedding(modelId);
    } catch (cause) {
      ctx
        .logger("yesimbot.chat-learning")
        .warn("chat_learning.embedding_model_unavailable", { model: modelId, cause: cause instanceof Error ? cause.message : String(cause) });
      return new Map();
    }

    const patterns: Array<{ key: string; phrase: string }> = [];
    for (const pattern of responsePatterns) {
      patterns.push({ key: `response:${pattern.intent}:${pattern.phrase}`, phrase: pattern.phrase });
    }
    for (const pattern of initiationPatterns) {
      patterns.push({ key: `initiation:${pattern.intent}:${pattern.phrase}`, phrase: pattern.phrase });
    }
    if (patterns.length === 0) return new Map();

    try {
      const result = await embedMany({ model, values: patterns.map((pattern) => pattern.phrase), maxRetries: 0 });
      const map = new Map<string, readonly number[]>();
      result.embeddings.forEach((embedding, index) => {
        const pattern = patterns[index];
        if (pattern) map.set(pattern.key, embedding as number[]);
      });
      return map;
    } catch (cause) {
      ctx
        .logger("yesimbot.chat-learning")
        .warn("chat_learning.embedding_failed", { model: modelId, cause: cause instanceof Error ? cause.message : String(cause) });
      return new Map();
    }
  };
  return cache && key ? cache.getOrProduce(key, produce) : produce();
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
