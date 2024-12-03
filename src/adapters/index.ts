import { Config } from "../config";
import { CloudflareAdapter } from "./cloudflare";
import { CustomAdapter } from "./custom";
import { OllamaAdapter } from "./ollama";
import { OpenAIAdapter } from "./openai";

export { CloudflareAdapter, CustomAdapter, OllamaAdapter, OpenAIAdapter };

export type Adapter =
  | CloudflareAdapter
  | CustomAdapter
  | OllamaAdapter
  | OpenAIAdapter;

export function register(
  adapterName: string,
  baseUrl: string,
  apiKey: string,
  uid: string,
  model: string,
  parameters: Config["Parameters"],
): Adapter {
  switch (adapterName) {
    case "Cloudflare":
      return new CloudflareAdapter(baseUrl, apiKey, uid, model, parameters);
    case "Custom URL":
      return new CustomAdapter(baseUrl, apiKey, model, parameters);
    case "Ollama":
      return new OllamaAdapter(baseUrl, apiKey, model, parameters);
    case "OpenAI":
      return new OpenAIAdapter(baseUrl, apiKey, model, parameters);
    default:
      throw new Error(`不支持的 API 类型: ${adapterName}`);
  }
}

export class AdapterSwitcher {
  private adapters: Adapter[];
  private current = 0;
  constructor(
    adapterConfig: Config["API"]["APIList"],
    parameters: Config["Parameters"]
  ) {
    this.updateConfig(adapterConfig, parameters);
  }

  getAdapter() {
    try {
      if (this.current >= this.adapters.length) this.current = 0;
      return {current: this.current, adapter: this.adapters[this.current++]}
    } catch (error) {
      return 
    }
  }

  updateConfig(
    adapterConfig: Config["API"]["APIList"],
    parameters: Config["Parameters"]
  ) {
    this.adapters = [];
    for (const adapter of adapterConfig) {
      this.adapters.push(
        register(
          adapter.APIType,
          adapter.BaseURL,
          adapter.APIKey,
          adapter.UID,
          adapter.AIModel,
          parameters,
        )
      );
    }
  }
}
