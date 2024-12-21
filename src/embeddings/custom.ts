import { CacheManager } from "../managers/cacheManager";
import { sendRequest } from "../utils/http";
import { EmbeddingsBase } from "./base";
import { Config } from "./config";

export class CustomEmbedding extends EmbeddingsBase {
  protected model: string;
  readonly embedding_dims: number;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: Config, manager?: CacheManager<number[]>) {
    super(config, manager);

    this.model = this.config.EmbeddingModel || "text-embedding-3-small";
    this.embedding_dims = this.config.EmbeddingDims || 1536;

    this.apiKey = this.config.APIKey;
    this.baseUrl = this.config.BaseURL;
  }

  async _embed(text: string): Promise<number[]> {
    const requestBody = {
      input: text,
      model: this.model,
    };
    const response = await sendRequest(
      `${this.baseUrl}`,
      this.apiKey,
      requestBody
    );

    return response.data[0].embedding;
  }
}
