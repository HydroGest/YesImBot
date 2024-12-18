import path from "path";
import https from "https";
import fs from "fs";
import { createHash } from "crypto";

import axios from "axios";
import sharp from "sharp";
import { formatSize } from "./string";



const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export async function compressImage(buffer: Buffer): Promise<Buffer> {
  while (buffer.length > MAX_IMAGE_SIZE) {
    const quality = Math.max(10, Math.floor((MAX_IMAGE_SIZE / buffer.length) * 80)); // 动态调整质量
    buffer = await sharp(buffer)
      .jpeg({ quality })
      .toBuffer();
  }
  return buffer;
}

interface Metadata {
  url: string;
  size: number;
  hash: string;
  contentType: string;
  createdAt: number;
  fileUnique?: string;
}

class ImageCache {
  private metadata: { [key: string]: Metadata };
  private metadataFile: string;

  public getMetadata(key: string): Metadata | undefined {
    return this.metadata[key];
  }

  constructor(private savePath: string) {
    // 确保目录存在
    if (!fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }

    this.metadataFile = path.join(this.savePath, "metadata.json");

    // 确保 metadata.json 文件存在
    if (!fs.existsSync(this.metadataFile)) {
      fs.writeFileSync(this.metadataFile, "{}", "utf-8");
    }

    try {
      const metadataContent = fs.readFileSync(this.metadataFile, "utf-8");
      this.metadata = JSON.parse(metadataContent);
    } catch (error) {
      console.error("Error reading metadata file:", error);
      this.metadata = {};
      // 如果读取失败，创建一个新的空metadata文件
      fs.writeFileSync(this.metadataFile, "{}", "utf-8");
    }
  }

  get(key: string): Buffer {
    const metadata = this.metadata[key];
    if (metadata) {
      try {
        return fs.readFileSync(path.join(this.savePath, metadata.hash));
      } catch (error) {
        console.error(`Error reading file for key ${key}:`, error);
        throw new Error(`Image not found: ${key}`);
      }
    }
    throw new Error(`Image not found: ${key}`);
  }

  getBase64(key: string): string {
    const metadata = this.metadata[key];
    if (metadata) {
      try {
        const buffer = fs.readFileSync(path.join(this.savePath, metadata.hash));
        return `data:${metadata.contentType};base64,${buffer.toString("base64")}`;
      } catch (error) {
        console.error(`Error reading file for key ${key}:`, error);
        throw new Error(`Image not found: ${key}`);
      }
    }
    throw new Error(`Image not found: ${key}`);
  }

  set(url: string, buffer: Buffer, contentType: string, hash?: string, fileUnique?: string): void {
    if (!hash) {
      hash = createHash('md5').update(buffer).digest('hex');
    }
    if (!fileUnique) {
      fileUnique = hash;
    }
    this.metadata[fileUnique] = {
      url: url,
      size: buffer.length,
      hash,
      contentType,
      createdAt: Date.now(),
      fileUnique,
    };
    const filePath = path.join(this.savePath, hash);
    try {
      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
    } catch (error) {
      console.error("Error writing files:", error);
      delete this.metadata[fileUnique];
      fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
      throw error;
    }
  }

  has(key: string): boolean {
    return key in this.metadata;
  }

  delete(key: string): void {
    if (key in this.metadata) {
      const hash = this.metadata[key].hash;
      const filePath = path.join(this.savePath, hash);
      try {
        fs.unlinkSync(filePath);
        delete this.metadata[key];
        fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), "utf-8");
      } catch (error) {
        console.error(`Error deleting file for key ${key}:`, error);
        throw error;
      }
    }
  }

  clear(): void {
    try {
      fs.readdirSync(this.savePath).forEach(file => {
        fs.unlinkSync(path.join(this.savePath, file));
      });
      this.metadata = {};
      fs.writeFileSync(this.metadataFile, "{}", "utf-8");
    } catch (error) {
      console.error("Error clearing cache:", error);
      throw error;
    }
  }

  keys(): string[] {
    return Object.keys(this.metadata);
  }
}

const imageCache = new ImageCache(path.join(__dirname, "../../data/cache/downloadImage"));

/**
 * 从URL获取图片的base64编码
 * @param url 图片的URL
 * @param cacheKey 指定缓存键
 * @param [ignoreCache=false] 是否忽略缓存
 * @returns 图片的base64编码
 */
export async function convertUrltoBase64(url: string, cacheKey?: string, ignoreCache = false, debug = false): Promise<string> {
  url = decodeURIComponent(url);

  if (!ignoreCache && imageCache.has(cacheKey)) {
    const base64 = imageCache.getBase64(cacheKey);
    const metadata = imageCache.getMetadata(cacheKey);
    if (debug) {
      logger.info(`Image loaded from cache: ${cacheKey.substring(0, 7)}. file-size: ${formatSize(metadata?.size || 0)}.`);
    }
    return `data:${metadata?.contentType};base64,${base64}`;
  }
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
      },
      responseType: "arraybuffer",
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 忽略SSL证书验证
      timeout: 5000, // 5秒超时
    });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers["content-type"] || "image/jpeg";
    const buffer = await compressImage(Buffer.from(response.data));
    const hash = createHash('md5').update(buffer).digest('hex');
    imageCache.set(url, buffer, contentType, hash, cacheKey || hash);
    if (debug) {
      logger.info(`Image downloaded: ${url.substring(0, 7)}. file-size: ${formatSize(buffer.length)}.`);
    }
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    logger.error("Error converting image to base64:", error.message);
    return "";
  }
}

// 去除base64前缀
export function removeBase64Prefix(base64: string): string {
  return base64.replace(/^data:image\/(jpg|jpeg|png|webp|gif|bmp|tiff|ico|avif|webm|apng|svg);base64,/, "");
}
