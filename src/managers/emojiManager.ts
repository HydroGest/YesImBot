import path from "path";
import JSON5 from "json5";
import { readFileSync } from "fs";

import { Config } from "../config";
import { calculateCosineSimilarity, EmbeddingsBase } from "../embeddings/base";
import { getEmbedding } from "../utils/factory";
import { CacheManager } from "./cacheManager";


interface Emoji {
  id: string;
  name: string;
}

export class EmojiManager {
  private idToName: { [key: string]: string } = {};
  private nameToId: { [key: string]: string } = {};
  private nameEmbeddings: { [key: string]: number[] } = {};
  private lastEmbeddingModel: string | null = null;
  private client: EmbeddingsBase;

  constructor(embeddingConfig: Config["Embedding"]) {
    const emojisFile = path.join(__dirname, "../../data/emojis.json");
    const emojis: Emoji[] = JSON5.parse(readFileSync(emojisFile, "utf-8"));

    emojis.forEach((emoji) => {
      this.idToName[emoji.id] = emoji.name;
      this.nameToId[emoji.name] = emoji.id;
    });

    const modelName = embeddingConfig.EmbeddingModel;
    const cacheFile = path.join(__dirname, `../../data/.vector_cache/emoji_${modelName}.bin`);
    const cacheManager = new CacheManager<number[]>(cacheFile, true);
    this.client = getEmbedding(embeddingConfig, cacheManager);
  }

  private async initializeEmbeddings(embeddingConfig: Config["Embedding"], debug = false): Promise<void> {
    const currentModel = embeddingConfig.EmbeddingModel;
    const needsRecompute =
      Object.keys(this.nameEmbeddings).length === 0 ||
      this.lastEmbeddingModel !== currentModel;

    if (needsRecompute) {
      // 清空现有嵌入
      this.nameEmbeddings = {};

      const names = Object.values(this.idToName);
      for (const name of names) {
        this.nameEmbeddings[name] = await this.client.embed(name);
      }

      // 更新已使用的模型记录
      this.lastEmbeddingModel = currentModel;
    }
  }

  // 通过ID查询表情名称
  // console.log(emojiManager.getNameById('1')); // 输出: '撇嘴'

  // 通过表情名称查询ID
  // console.log(emojiManager.getIdByName('撇嘴')); // 输出: '1'

  async getNameById(id: string): Promise<string | undefined> {
    return this.idToName[id];
  }

  async getIdByName(name: string): Promise<string | undefined> {
    return this.nameToId[name];
  }

  async getNameByTextSimilarity(
    name: string,
    embeddingConfig: Config["Embedding"],
    debug = false
  ): Promise<string | undefined> {
    try {
      // 确保已初始化所有表情名称的嵌入向量
      await this.initializeEmbeddings(embeddingConfig, debug);

      // 获取输入文本的嵌入向量
      const inputEmbedding = await this.client._embed(name);

      let maxSimilarity = 0;
      let mostSimilarName: string | undefined;

      // 计算与所有表情名称的相似度
      for (const [emojiName, embedding] of Object.entries(
        this.nameEmbeddings
      )) {
        const similarity = calculateCosineSimilarity(inputEmbedding, embedding);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarName = emojiName;
        }
      }
      return mostSimilarName;
    } catch (error) {
      console.error("查找相似表情失败:", error);
      return undefined;
    }
  }
}
