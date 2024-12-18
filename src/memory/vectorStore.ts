import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { Context } from "koishi";

import { calculateCosineSimilarity } from "../embeddings/base";


interface Vector {
  id: string;        // 随机生成的id
  vector: number[];  // 向量
  magnitude: number; // 向量的模

  content: string;    // 记忆内容
  createdAt: number;  // 创建时间
  updatedAt?: number; // 更新时间，用于计算时间权重

  userId?: string;    // 记忆关联的用户ID
}

export interface Metadata {
  content: string;    // 记忆内容
  createdAt: number;  // 创建时间
  updatedAt?: number; // 更新时间，用于计算时间权重

  userId?: string;    // 记忆关联的用户ID
}

export class MemoryVectorStore {
  private vectors: Vector[];

  private vectorsFilePath = path.join(__dirname, "../../data/.vector_cache/memory.json");

  constructor(private ctx: Context) {
    this.vectors = [];

    this.loadVectors();
  }

  loadVectors() {
    if (!fs.existsSync(this.vectorsFilePath)) {
      fs.mkdirSync(path.dirname(this.vectorsFilePath), { recursive: true });
      fs.writeFileSync(this.vectorsFilePath, "[]", "utf-8");
    }
    const vectors = fs.readFileSync(this.vectorsFilePath, "utf-8");
    this.vectors = JSON.parse(vectors);
  }

  async addVector(vector: number[], metadata: Metadata) {
    const id = randomUUID();
    this.vectors.push({
      id,
      vector,
      magnitude: getMagnitude(vector),

      ...metadata,
    });
  }

  async addVectors(vectors: number[][], metadatas: Metadata[]): Promise<void> {
    vectors.forEach((vector, index) => {
      const id = randomUUID();
      this.vectors.push({
        id,
        vector,
        magnitude: getMagnitude(vector),

        ...metadatas[index],
      });
    });
  }

  /**
   * 将向量库持久化
   * 保存本地或者提交到数据库
   */
  commit() {
    const vectors = JSON.stringify(this.vectors);
    fs.writeFileSync(path.join(__dirname, "../../data/.vector_cache/memory.json"), vectors);
  }

  filterVectors(filter: (vector: Vector) => boolean): Vector[] {
    return this.vectors.filter(filter);
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
  async similaritySearchVectorWithScore(query: number[], k: number, filter?: (vector: Vector) => boolean): Promise<[Vector, number][]> {
    let results: [Vector, number][] = [];
    let magnitude = getMagnitude(query);

    const tasks = this.vectors.map(async (vector) => {
      const similarity = calculateCosineSimilarity(query, vector.vector, magnitude, vector.magnitude);
      results.push([vector, similarity]);
    });
    await Promise.all(tasks);
    if (filter) {
      results = results.filter(x => filter(x[0]));
    }
    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, k);
  }
}

export function getMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
}
