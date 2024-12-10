import { CacheManager } from "../managers/cacheManager";
import { sendRequest } from "../utils/http";
import { EmbeddingsBase } from "./base";
import { Config } from "./config";

export class OllamaEmbedding extends EmbeddingsBase {
  protected model: string;
  readonly embedding_dims: number;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: Config, manager?: CacheManager<number[]>) {
    super(config, manager);

    this.model = this.config.EmbeddingModel || "nomic-embed-text";
    this.embedding_dims = this.config.EmbeddingDims || 512;

    this.apiKey = this.config.APIKey;
    this.baseUrl = this.config.BaseURL;
  }

  async _embed(text: string): Promise<number[]> {
    const requestBody = {
      input: text,
      model: this.model,
    };
    const response = await sendRequest(
      `${this.baseUrl}/api/embed`,
      this.apiKey,
      requestBody
    );

    return response.embeddings[0];
  }

  // async embedBatch(texts: string[]): Promise<number[][]> {
  //   const result = await Promise.all(
  //     texts.map(async (text) => {
  //       return this.embed(text);
  //     })
  //   );
  //   return result;
  // }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const requestBody = {
      input: texts,
      model: this.model,
    }
    const response = await sendRequest(
      `${this.baseUrl}/api/embed`,
      this.apiKey,
      requestBody
    );
    return response.embeddings;
  }
}
