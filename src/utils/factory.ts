import { Config } from "../config";
import { CloudflareAdapter, CustomAdapter, OllamaAdapter, OpenAIAdapter } from "../adapters";
import { CustomEmbedding, OllamaEmbedding, OpenAIEmbedding } from "../embeddings";
import { CacheManager } from "../managers/cacheManager";
import { API } from "../adapters/config";

export function getAdapter(config: API, parameters?: Config["Parameters"]): any {
  const { APIType, BaseURL, UID, APIKey, AIModel } = config;
  switch (APIType) {
    case "Cloudflare":
      return new CloudflareAdapter(BaseURL, APIKey, UID, AIModel, parameters);
    case "Custom URL":
      return new CustomAdapter(BaseURL, APIKey, AIModel, parameters);
    case "Ollama":
      return new OllamaAdapter(BaseURL, APIKey, AIModel, parameters);
    case "OpenAI":
      return new OpenAIAdapter(BaseURL, APIKey, AIModel, parameters);
    default:
      throw new RangeError("Unknown adapter type");
  }}

export function getEmbedding(config: Config["Embedding"], manager?: CacheManager<number[]>) {
  switch (config.APIType) {
    case "OpenAI":
      return new OpenAIEmbedding(config, manager);
    case "Ollama":
      return new OllamaEmbedding(config, manager);
    case "Custom":
      return new CustomEmbedding(config, manager);
    default:
      throw new RangeError(`不支持的 Embedding 类型: ${config.APIType}`);
  }
}
