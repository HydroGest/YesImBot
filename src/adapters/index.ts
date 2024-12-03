import { Config } from "../config";
import { CloudflareAdapter } from "./cloudflare";
import { CustomAdapter } from "./custom";
import { OllamaAdapter } from "./ollama";
import { OpenAIAdapter } from "./openai";

export {
    CloudflareAdapter,
    CustomAdapter,
    OllamaAdapter,
    OpenAIAdapter
}

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
  model: string
): Adapter {
  switch (adapterName) {
    case "Cloudflare":
      return new CloudflareAdapter(baseUrl, apiKey, uid, model);
    case "Custom URL":
      return new CustomAdapter(baseUrl, apiKey, model);
    case "Ollama":
      return new OllamaAdapter(baseUrl, apiKey, model);
    case "OpenAI":
      return new OpenAIAdapter(baseUrl, apiKey, model);
    default:
      throw new Error(`不支持的 API 类型: ${adapterName}`);
  }
}


export class AdapterSwitcher {
  private adapters: Adapter[];
  private current = 0;
  constructor(private adapterConfig: Config["API"]["APIList"]){
    this.updateConfig(adapterConfig);
  }

  getAdapter(): Adapter {
    if (this.current >= this.adapters.length) this.current = 0;
    return this.adapters[this.current++];
  }

  updateConfig(adapterConfig: Config["API"]["APIList"]) {
    this.adapters = [];
    this.adapterConfig = adapterConfig;
    for (const adapter of adapterConfig) {
      this.adapters.push(register(
        adapter.APIType,
        adapter.BaseURL,
        adapter.APIKey,
        adapter.UID,
        adapter.AIModel
      ))
    }
  }
}