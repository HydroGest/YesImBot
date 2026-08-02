import type { LanguageModel } from "ai";

export const CHAT_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;

export type ModelId = `${string}:${string}`;
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

export interface ChatModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: ChatModelConfig;
  model: LanguageModel;
}

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
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
