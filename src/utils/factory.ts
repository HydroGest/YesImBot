import { Config } from "../config";
import { CloudflareAdapter, CustomAdapter, OllamaAdapter, OpenAIAdapter } from "../adapters";
import { CustomEmbedding, OllamaEmbedding, OpenAIEmbedding } from "../embeddings";
import { CacheManager } from "../managers/cacheManager";
import { LLM } from "../adapters/config";
import { BaseAdapter } from "../adapters/base";

export function getAdapter(config: LLM, parameters?: Config["Parameters"]): BaseAdapter {
  switch (config.APIType) {
    case "Cloudflare":
      return new CloudflareAdapter(config, parameters);
    case "Custom URL":
      return new CustomAdapter(config, parameters);
    case "Ollama":
      return new OllamaAdapter(config, parameters);
    case "OpenAI":
      return new OpenAIAdapter(config, parameters);
    default:
      throw new Error(`不支持的 API 类型: ${config.APIType}`);
  }
}

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
