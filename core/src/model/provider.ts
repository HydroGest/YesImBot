import type { EmbeddingModel, LanguageModel } from "ai";
import { Context, Schema } from "koishi";

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

export interface ChatModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: ChatModelConfig;
  model: LanguageModel;
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

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
}

export function createProviderPlugin<TConfig extends BaseProviderConfig, TClient>(
  options: {
    name: string;
    capabilities: { chat: boolean; embedding: boolean };
    Config: unknown;
    createClient: (config: { apiKey: string; baseURL?: string }) => TClient;
    chat: (client: TClient, modelId: string, config: TConfig) => LanguageModel;
    embedding?: (client: TClient, modelId: string, config: TConfig) => EmbeddingModel;
  },
): {
  name: string;
  reusable: boolean;
  inject: string[];
  Config: unknown;
  apply: (ctx: Context, config: TConfig) => void;
} {
  const { name, capabilities, Config, createClient, chat, embedding } = options;

  return {
    name,
    reusable: true,
    inject: ["yesimbot.model"],
    Config,
    apply(ctx: Context, config: TConfig) {
      const client = createClient({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });

      const provider = {
        id: config.id,
        capabilities,
        chatModels: () => (capabilities.chat ? config.chatModels : []),
        embeddingModels: () => (capabilities.embedding ? (config.embeddingModels ?? []) : []),
        chat: capabilities.chat
          ? (modelId: string) => chat(client, modelId, config)
          : () => {
              throw new Error(`Provider "${config.id}" does not support chat`);
            },
        embedding: capabilities.embedding
          ? (modelId: string) => embedding!(client, modelId, config)
          : () => {
              throw new Error(`Provider "${config.id}" does not support embedding`);
            },
      };

      const disposeProvider = ctx["yesimbot.model"].register(provider);
      ctx.on("dispose", disposeProvider);
    },
  };
}

export function createChatModelsSchema(defaults: ChatModelConfig[]): Schema<ChatModelConfig[]> {
  const schema = Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("支持工具调用"),
      reasoning: Schema.boolean().default(false).description("支持推理"),
    }),
  )
    .role("table")
    .default(defaults as never)
    .description("可用聊天模型列表");
  return schema as Schema<ChatModelConfig[]>;
}

export function createEmbeddingModelsSchema(
  defaults: EmbeddingModelConfig[],
): Schema<EmbeddingModelConfig[]> {
  const schema = Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
    }),
  )
    .role("table")
    .default(defaults)
    .description("可用嵌入模型列表");
  return schema as Schema<EmbeddingModelConfig[]>;
}
