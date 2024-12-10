import path from "path";

import { Config } from "../config";
import { calculateCosineSimilarity, EmbeddingsBase } from "../embeddings/base";
import { CacheManager } from "../managers/cacheManager";
import { getEmbedding } from "../utils/factory";

interface Vector {
  id: string;
  vector: number[];
  metadata: any;
}

export class MemoryVectorStore {
  private vectors: Vector[];

  constructor() {
    this.vectors = [];
  }

  async addVectors(vectors: number[][], metadatas: any[]): Promise<void> {
    vectors.forEach((vector, index) => {
      const id = this.generateId();
      this.vectors.push({
        id,
        vector,
        metadata: metadatas[index],
      });
    });
  }

  /**
   * Find k most similar vectors to the given query vector.
   *
   * This function returns the k most similar vectors to the given query vector,
   * along with their similarity scores. The similarity is calculated using the
   * cosine similarity metric.
   *
   * @param query The query vector to search for.
   * @param k The number of most similar vectors to return.
   * @returns An array of [Vector, number] pairs, where the first element is the
   *          vector and the second element is the similarity score. The array is
   *          sorted in descending order of similarity score.
   */
  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Vector, number][]> {
    const results: [Vector, number][] = [];

    for (const vector of this.vectors) {
      const similarity = calculateCosineSimilarity(query, vector.vector);
      results.push([vector, similarity]);
    }

    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, k);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}

export class Memory {
  private vectorStore: MemoryVectorStore;
  private history: { role: string; content: string }[];
  private config: Config["Embedding"];
  private client: EmbeddingsBase;

  constructor(config: Config["Embedding"]) {
    this.vectorStore = new MemoryVectorStore();
    this.history = [];
    this.config = config;

    const cacheManager = new CacheManager<number[]>(path.join(__dirname, `../../data/.vector_cache/memory.bin`), true);
    this.client = getEmbedding(config, cacheManager);
  }

  async addMessage(message: string, role: string): Promise<void> {
    this.history.push({ role, content: message });
    const embedding = await this.client.embed(message);
    await this.vectorStore.addVectors([embedding], [message]);
  }

  async getHistory(): Promise<{ role: string; content: string }[]> {
    return this.history;
  }

  async getSimilarMessages(message: string, k = 5): Promise<string[]> {
    const embedding = await this.client.embed(message);
    const results = await this.vectorStore.similaritySearchVectorWithScore(embedding, k);
    return results.map((result) => result[0].metadata);
  }
}

export default Memory;
