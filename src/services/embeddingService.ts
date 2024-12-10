import path from "path";
import JSON5 from "json5";

import { Config } from "../config";
import { sendRequest } from "../utils/http";
import { CacheManager } from "../managers/cacheManager";

const managers: Map<string, CacheManager<number[]>> = new Map();
function getManager(embeddingModel: string): CacheManager<number[]> {
  if (!managers.has(embeddingModel)) {
    const manager = new CacheManager<number[]>(path.join(__dirname, `../../data/.vector_cache/${embeddingModel}.bin`), true);
    managers.set(embeddingModel, manager);
  }
  return managers.get(embeddingModel)!;
}

export async function runEmbedding(
  embeddingConfig: Config["Embedding"],
  text: string,
  debug: boolean,
): Promise<number[]> {
  const { APIType, BaseURL, APIKey, EmbeddingModel, RequestBody, GetVecRegex } = embeddingConfig;
  // 检查缓存
  const cacheManager = getManager(EmbeddingModel);
  const cachedVector = cacheManager.get(text);
  if (cachedVector) {
    if (debug) {
      logger.info('Using cached embedding vector');
    }
    return cachedVector;
  }

  let url: string;
  let finalRequestBody: any;

  try {
    switch (APIType) {
      case "OpenAI": {
        url = `${BaseURL}/v1/embeddings`;
        finalRequestBody = {
          input: text,
          model: EmbeddingModel,
        };
        break;
      }

      case "Custom URL": {
        url = BaseURL;
        finalRequestBody = {
          input: text,
          model: EmbeddingModel,
        };
        break;
      }

      case "Cloudflare": {
        logger.warn("Cloudflare 暂不支持");
        break;
      }

      case "Custom": {
        url = BaseURL;
        if (!GetVecRegex) {
          throw new Error("Custom API 需要提供 getVecRegex 参数");
        }

        if (RequestBody) {
          const processedBody = RequestBody
            .replace(/<text>/g, text)
            .replace(/<apikey>/g, APIKey)
            .replace(/<model>/g, EmbeddingModel);

          try {
            finalRequestBody = JSON5.parse(processedBody);
          } catch (e) {
            throw new Error(`自定义请求体解析失败: ${e.message}`);
          }
        } else {
          finalRequestBody = {
            input: text,
            model: EmbeddingModel,
          };
        }
        break;
      }
    }

    const response = await sendRequest(url, APIKey, finalRequestBody, debug);
    let vector: number[];

    if (APIType === "OpenAI" || APIType === "Custom URL") {
      vector = response.data[0].embedding;
      cacheManager.set(text, vector);
      return vector;
    } else {
      const regex = new RegExp(GetVecRegex);
      const match = JSON.stringify(response).match(regex);
      if (!match) {
        throw new Error("无法从响应中提取向量");
      }
      try {
        vector = JSON.parse(match[0]);
        cacheManager.set(text, vector);
        return vector;
      } catch (e) {
        throw new Error(`向量解析失败: ${e.message}`);
      }
    }
  } catch (error) {
    throw new Error(`Embedding 请求失败: ${error.message}`);
  }
}


// 计算向量的余弦相似度
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
    return 0;
  }
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  return magnitude1 && magnitude2 ? (dotProduct / (magnitude1 * magnitude2) + 1) / 2 : 0; // Transform from [-1, 1] to [0, 1]
}
