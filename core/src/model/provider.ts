import type { EmbeddingModel, LanguageModel } from "ai";
import { Context } from "koishi";

import type {
  ChatModelConfig,
  EmbeddingModelConfig,
  ModelProvider,
  ModelProviderCapabilities,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
}

export interface ProviderPluginOptions<TConfig extends BaseProviderConfig, TClient> {
  /** Koishi plugin name, e.g. "yesimbot-provider-openai" */
  name: string;
  /** Static capability flags */
  capabilities: ModelProviderCapabilities;
  /** Koishi Config schema — attached to the plugin object so Koishi can validate config */
  Config: unknown;
  /** Create the SDK client from config */
  createClient: (config: { apiKey: string; baseURL?: string }) => TClient;
  /** Adapt SDK client + modelId → LanguageModel */
  chat: (client: TClient, modelId: string, config: TConfig) => LanguageModel;
  /** Adapt SDK client + modelId → EmbeddingModel (omit when capabilities.embedding is false) */
  embedding?: (client: TClient, modelId: string, config: TConfig) => EmbeddingModel;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Koishi plugin that registers a ModelProvider.
 *
 * Eliminates the ~60-line boilerplate shared by every provider: client
 * construction, ModelProvider object, register/unregister lifecycle, and
 * the "no embedding" throw pattern.
 */
export function createProviderPlugin<TConfig extends BaseProviderConfig, TClient>(
  options: ProviderPluginOptions<TConfig, TClient>,
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

      const provider: ModelProvider = {
        id: config.id,
        capabilities,
        chatModels: () => (capabilities.chat ? config.chatModels : []),
        embeddingModels: () => (capabilities.embedding ? (config.embeddingModels ?? []) : []),
        chat: capabilities.chat
          ? (modelId) => chat(client, modelId, config)
          : () => {
              throw new Error(`Provider "${config.id}" does not support chat`);
            },
        embedding: capabilities.embedding
          ? (modelId) => embedding!(client, modelId, config)
          : () => {
              throw new Error(`Provider "${config.id}" does not support embedding`);
            },
      };

      const disposeProvider = ctx["yesimbot.model"].register(provider);
      ctx.on("dispose", disposeProvider);
    },
  };
}
