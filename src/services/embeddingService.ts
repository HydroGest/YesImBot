import JSON5 from "json5";

import { Config } from "../config";
import { getCacheFileName, loadFromCache, saveToCache } from "../managers/cacheManager";
import { sendRequest } from "../utils/http";

export async function runEmbedding(
  apiType: Config["Embedding"]["APIType"],
  baseURL: string,
  apiKey: string,
  embeddingModel: string,
  text: string,
  debug: boolean,
  requestBody?: string,
  getVecRegex?: string
): Promise<number[]> {
  // 检查缓存
  const cacheFile = getCacheFileName(embeddingModel, text);
  const cachedVector = loadFromCache(cacheFile);
  if (cachedVector) {
    if (debug) {
      console.log('Using cached embedding vector');
    }
    return cachedVector;
  }

  let url: string;
  let finalRequestBody: any;

  try {
    switch (apiType) {
      case "OpenAI": {
        url = `${baseURL}/v1/embeddings`;
        finalRequestBody = {
          input: text,
          model: embeddingModel,
        };
        break;
      }

      case "Custom URL": {
        url = baseURL;
        finalRequestBody = {
          input: text,
          model: embeddingModel,
        };
        break;
      }

      case "Cloudflare": {
        console.log("Cloudflare 暂不支持");
        break;
      }

      case "Custom": {
        url = baseURL;
        if (!getVecRegex) {
          throw new Error("Custom API 需要提供 getVecRegex 参数");
        }

        if (requestBody) {
          const processedBody = requestBody
            .replace(/<text>/g, text)
            .replace(/<apikey>/g, apiKey)
            .replace(/<model>/g, embeddingModel);

          try {
            finalRequestBody = JSON5.parse(processedBody);
          } catch (e) {
            throw new Error(`自定义请求体解析失败: ${e.message}`);
          }
        } else {
          finalRequestBody = {
            input: text,
            model: embeddingModel,
          };
        }
        break;
      }
    }

    const response = await sendRequest(url, apiKey, finalRequestBody, debug);
    let vector: number[];

    if (apiType === "OpenAI" || apiType === "Custom URL") {
      vector = response.data[0].embedding;
      saveToCache(cacheFile, vector);
      return vector;
    } else {
      const regex = new RegExp(getVecRegex);
      const match = JSON.stringify(response).match(regex);
      if (!match) {
        throw new Error("无法从响应中提取向量");
      }
      try {
        vector = JSON.parse(match[0]);
        saveToCache(cacheFile, vector);
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