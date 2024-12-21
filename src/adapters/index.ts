import { Config } from "../config";
import { CloudflareAdapter } from "./cloudflare";
import { CustomAdapter } from "./custom";
import { OllamaAdapter } from "./ollama";
import { OpenAIAdapter } from "./openai";
import { getAdapter } from "../utils/factory";
import { BaseAdapter } from "./base";

export { CloudflareAdapter, CustomAdapter, OllamaAdapter, OpenAIAdapter };

export class AdapterSwitcher {
  private adapters: BaseAdapter[];
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
      return { current: this.current, adapter: this.adapters[this.current++] };
    } catch (error) {
      return;
    }
  }

  updateConfig(
    adapterConfig: Config["API"]["APIList"],
    parameters: Config["Parameters"]
  ) {
    this.adapters = [];
    for (const adapter of adapterConfig) {
      this.adapters.push(getAdapter(adapter, parameters));
    }
  }
}
