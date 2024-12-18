import { Context } from "koishi";

import { BaseAdapter } from "../adapters/base";
import { Message } from "../adapters/creators/component";
import { Config } from "../config";
import { EmbeddingsBase } from "../embeddings/base";
import { getAdapter, getEmbedding } from "../utils/factory";
import { MemoryVectorStore } from "./vectorStore";
import { LLM} from "../adapters/config";
import { EmbeddingsConfig } from "../embeddings";

export class Memory {
  private vectorStore: MemoryVectorStore;

  private llm: BaseAdapter;
  private embedder: EmbeddingsBase;

  constructor(
    ctx: Context,
    adapterConfig: LLM,
    embedderConfig: EmbeddingsConfig,
    parameters?: Config["Parameters"]
  ) {
    this.vectorStore = new MemoryVectorStore(ctx);
    this.llm = getAdapter(adapterConfig, parameters);
    this.embedder = getEmbedding(embedderConfig);
  }

  async add(messages: string | Message[], userId?: string) {}

  async search(
    query: string,
    limit: number = 5,
    userId?: string
  ): Promise<string[]> {
    const embedding = await this.embedder.embed(query);

    const result = await this.vectorStore.similaritySearchVectorWithScore(
      embedding,
      limit,
      userId ? (metadata) => metadata.userId === userId : undefined
    );
    const response = result.map((item) => item[0].content);
    return response;
  }

  getUserMemory(userId: string): string[] {
    let vectors = this.vectorStore.filterVectors(
      (vector) => vector.userId === userId
    );
    return vectors.map((vector) => {
      return vector.content;
    });
  }
  getSelfMemory() {
    return this.getUserMemory("self");
  }
}

