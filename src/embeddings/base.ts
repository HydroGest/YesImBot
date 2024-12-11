import { CacheManager } from "../managers/cacheManager";
import { Config } from "./config";

export abstract class EmbeddingsBase {
  protected readonly cache: CacheManager<number[]>;

  constructor(protected config: Config, manager?: CacheManager<number[]>) {
    this.cache = manager;
  }

  abstract _embed(text: string): Promise<number[]>;

  async embed(text: string): Promise<number[]> {
    if (this.cache && this.cache.has(text)) {
      return this.cache.get(text);
    } else {
      const result = await this._embed(text);
      await this.cache?.set(text, result);
      return result;
    }
  }
}

/**
 * 计算向量的余弦相似度
 **/
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
    return 0;
  }
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return magnitude1 && magnitude2 ? (dotProduct / (magnitude1 * magnitude2) + 1) / 2 : 0; // Transform from [-1, 1] to [0, 1]
}

// function batchCosineSimilarity(queryMatrix: number[][], vectorsMatrix: number[][]): number[][] {
//   const dotProducts = math.multiply(queryMatrix, math.transpose(vectorsMatrix));
//   const queryMagnitudes = math.sqrt(math.sum(math.square(queryMatrix), 1));
//   const vectorsMagnitudes = math.sqrt(math.sum(math.square(vectorsMatrix), 1));
//   const magnitudesProduct = math.multiply(queryMagnitudes, math.transpose(vectorsMagnitudes));
//   return math.divide(dotProducts, magnitudesProduct);
// }
