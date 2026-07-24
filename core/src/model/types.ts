import type { EmbeddingModel, LanguageModel } from "ai";

export type ModelId = `${string}:${string}`;

export const CHAT_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;
export type ChatModelModality = (typeof CHAT_MODEL_MODALITIES)[number];

export interface ChatModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  toolCall?: boolean;
  reasoning?: boolean;
  limit?: {
    context: number;
    output: number;
  };
  modalities?: {
    input?: ChatModelModality[];
    output?: ChatModelModality[];
  };
  variants?: Record<string, unknown>;
}

export interface EmbeddingModelConfig {
  id: string;
  name?: string;
  hidden?: boolean;
  dimension?: number;
}

export interface ModelProviderCapabilities {
  chat: boolean;
  embedding: boolean;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelProviderCapabilities;
  chatModels(): ChatModelConfig[];
  embeddingModels(): EmbeddingModelConfig[];
  chat?(modelId: string): LanguageModel;
  embedding?(modelId: string): EmbeddingModel;
}

export interface ChatModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: ChatModelConfig;
  model: LanguageModel;
}

export interface EmbeddingModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: EmbeddingModelConfig;
  model: EmbeddingModel;
}

export function isChatModelModality(value: string): value is ChatModelModality {
  return CHAT_MODEL_MODALITIES.some((modality) => modality === value);
}

export function parseModelId(fullId: string): { provider: string; model: string } | null {
  const idx = fullId.indexOf(":");
  if (idx <= 0) return null;
  return { provider: fullId.slice(0, idx), model: fullId.slice(idx + 1) };
}

export function formatModelId(providerId: string, modelId: string): ModelId {
  return `${providerId}:${modelId}`;
}
