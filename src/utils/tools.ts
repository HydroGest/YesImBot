import axios from "axios";
import JSON5 from "json5";
import path from 'path';
import fs from 'fs';
import { Config } from "../config";
import https from 'https';
import sharp from 'sharp';

export async function sendRequest(url: string, APIKey: string, requestBody: any, debug: boolean): Promise<any> {
  if (debug) {
    console.log(`Request URL: ${url}`);
    console.log(`Request body: \n${foldText(JSON5.stringify(requestBody, null, 2), 2100)}`);
  }

  try {
    const response = await axios.post(url, requestBody, {
      headers: {
        'Authorization': `Bearer ${APIKey}`,
        'Content-Type': "application/json",
      },
    });

    if (response.status !== 200) {
      const errorMessage = JSON5.stringify(response.data);
      throw new Error(`请求失败: ${response.status} - ${errorMessage}`);
    }

    const result = await response.data;
    return result;
  } catch (error) {
    if (error.response) {
      throw new Error(`请求失败: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}


// 缓存相关 考虑把它们放到一个单独的文件中 这样做基于md5的图片缓存的时候也可以用到
function getCacheDir(): string {
  const cacheDir = path.join(__dirname, '../../data/.vector_cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

function getCacheFileName(model: string, text: string): string {
  // 创建模型专用的子目录
  const modelDir = path.join(getCacheDir(), model);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  const safeText = text.slice(0, 100)

  return path.join(modelDir, `${safeText}.json`);
}
function saveToCache(fileName: string, vector: number[]): void {
  // 确保目标目录存在
  const dir = path.dirname(fileName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fileName, JSON.stringify(vector));
}

function loadFromCache(fileName: string): number[] | null {
  if (fs.existsSync(fileName)) {
    try {
      return JSON.parse(fs.readFileSync(fileName, 'utf-8'));
    } catch (error) {
      console.warn(`读取缓存文件失败: ${fileName}`, error);
      return null;
    }
  }
  return null;
}

export async function runEmbedding(
  apiType: Config["Embedding"]["APIType"],
  baseURL: string,
  apiKey: string,
  embeddingModel: string,
  text: string,
  debug: boolean,
  requestBody?: string,
  getVecRegex?: string,
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
  if (vec1.length !== vec2.length) {
    throw new Error('向量维度不匹配');
  }
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  const cosineSimilarity = dotProduct / (magnitude1 * magnitude2);
  return (cosineSimilarity + 1) / 2; // Transform from [-1, 1] to [0, 1]
}

// 检查群组是否在允许的群组组合列表中，并返回首个匹配到的群组组合配置或者所有匹配到的群组组合配置
export function isGroupAllowed(groupId: string, allowedGroups: string[], debug: boolean = false): [boolean, Set<string>] {
  const isPrivate = groupId.startsWith("private:");
  const matchedGroups = new Set<string>();

  // 遍历每个allowedGroups元素
  for (const groupConfig of allowedGroups) {
    // 使用Set去重
    const groups = new Set(
      groupConfig.split(",")
        .map(g => g.trim())
        .filter(g => g)  // 移除空字符串
    );

    for (const group of groups) {
      // 检查全局允许
      if (!isPrivate && group === "all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 检查全局私聊允许
      if (isPrivate && group === "private:all") {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
      // 精确匹配
      if (groupId === group) {
        if (debug) {
          groups.forEach(g => matchedGroups.add(g));
        } else {
          return [true, groups];
        }
      }
    }
  }

  if (debug && matchedGroups.size > 0) {
    return [true, matchedGroups];
  }

  return [false, new Set()];
}

// 从URL获取图片的base64编码
export async function convertUrltoBase64(url: string): Promise<string> {
  url = url.replace(/&amp;/g, '&');
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 忽略SSL证书验证
      timeout: 5000  // 5秒超时
    });

    let buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'image/jpeg';

    // 如果图片大小大于10MB，压缩图片到10MB以内
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (buffer.length > maxSize) {
      do {
        buffer = await sharp(buffer)
          .jpeg({ quality: Math.max(10, Math.floor((maxSize / buffer.length) * 80)) }) // 动态调整质量
          .toBuffer();
      } while (buffer.length > maxSize);
    }

    const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;
    return base64;
  } catch (error) {
    console.error('Error converting image to base64:', error.message);
    return "";
  }
}

// 折叠文本中间部分
export function foldText(text: string, maxLength: number): string {
  if (text.length > maxLength) {
    const halfLength = Math.floor(maxLength / 2);
    const foldedChars = text.length - maxLength;
    return text.slice(0, halfLength) +
      '\x1b[33m...[已折叠 ' +
      '\x1b[33;1m' + foldedChars +
      '\x1b[0m\x1b[33m 个字符]...\x1b[0m' +
      text.slice(-halfLength);
  }
  return text;
}
