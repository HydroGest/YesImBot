import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import { type EmbeddingModel, type EmbeddingModelMiddleware, type LanguageModelMiddleware, wrapEmbeddingModel, wrapLanguageModel } from "ai";
import type { ChatModelRef } from "koishi-plugin-yesimbot";

import type { NormalizedUsage, UsageRecordInput } from "./types.js";

interface PatchedModelService {
  resolveChatModel(fullId: string): ChatModelRef;
  resolveEmbedding(fullId: string): EmbeddingModel;
}

interface RawUsageInput {
  inputTokens?: number | { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: number | { total?: number; text?: number; reasoning?: number };
  cachedInputTokens?: number;
}

export function normalizeLanguageUsage(usage: unknown): NormalizedUsage {
  const raw = (usage ?? {}) as RawUsageInput;
  const input = raw.inputTokens;
  const output = raw.outputTokens;
  const inputDetail = typeof input === "object" && input !== null ? input : undefined;
  const outputDetail = typeof output === "object" && output !== null ? output : undefined;
  const inputTokens = inputDetail ? toNumber(inputDetail.total) : toNumber(input);
  const cacheReadTokens = inputDetail ? toNumber(inputDetail.cacheRead) : toNumber(raw.cachedInputTokens);
  const cacheWriteTokens = inputDetail ? toNumber(inputDetail.cacheWrite) : 0;
  const explicitNoCacheTokens = inputDetail ? toNumber(inputDetail.noCache) : 0;
  const noCacheTokens = explicitNoCacheTokens > 0 ? explicitNoCacheTokens : Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);

  return { inputTokens, outputTokens: outputDetail ? toNumber(outputDetail.total) : toNumber(output), noCacheTokens, cacheReadTokens, cacheWriteTokens };
}

export function installModelUsagePatch(model: PatchedModelService, report: (record: UsageRecordInput) => void): () => void {
  const originalChat = model.resolveChatModel.bind(model);
  const originalEmbedding = model.resolveEmbedding.bind(model);

  model.resolveChatModel = (fullId) => {
    const ref = originalChat(fullId);
    if (!isModelObject(ref.model)) return ref;

    const wrapped = wrapLanguageModel({
      model: ref.model as LanguageModelV3,
      middleware: createLanguageUsageMiddleware((usage) =>
        report({ providerId: ref.providerId, modelId: ref.modelId, timestamp: Date.now(), kind: "chat", usage }),
      ),
      providerId: ref.providerId,
      modelId: ref.modelId,
    });

    return { ...ref, model: wrapped };
  };

  model.resolveEmbedding = (fullId) => {
    const embedding = originalEmbedding(fullId);
    if (!isModelObject(embedding)) return embedding;

    const providerId = typeof embedding.provider === "string" ? embedding.provider : "unknown";
    const modelId = typeof embedding.modelId === "string" ? embedding.modelId : fullId;
    return wrapEmbeddingModel({
      model: embedding as EmbeddingModelV3,
      middleware: createEmbeddingUsageMiddleware((usage) => report({ providerId, modelId, timestamp: Date.now(), kind: "embedding", usage })),
      providerId,
      modelId,
    });
  };

  return () => {
    model.resolveChatModel = originalChat;
    model.resolveEmbedding = originalEmbedding;
  };
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function createLanguageUsageMiddleware(report: (usage: NormalizedUsage) => void): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      report(normalizeLanguageUsage(result.usage));
      return result;
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      const stream = result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === "finish") {
              report(normalizeLanguageUsage(chunk.usage));
            }
            controller.enqueue(chunk);
          },
        }),
      );
      return { ...result, stream };
    },
  };
}

function createEmbeddingUsageMiddleware(report: (usage: NormalizedUsage) => void): EmbeddingModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapEmbed: async ({ doEmbed }) => {
      const result = await doEmbed();
      const raw = result as { usage?: { tokens?: unknown } };
      const inputTokens = toNumber(raw.usage?.tokens);
      report({ inputTokens, outputTokens: 0, noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
      return result;
    },
  };
}

function isModelObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
