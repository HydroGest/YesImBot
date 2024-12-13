import path from "path";
import https from "https";
import fs from "fs";
import { createHash } from "crypto";

import axios from "axios";
import sharp from "sharp";



const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

async function compressImage(buffer: Buffer): Promise<Buffer> {
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
}

class ImageCache {
  private readonly SEPARATOR = Buffer.from('@@METADATA@@');

  constructor(private savePath: string) {
    if (!fs.existsSync(this.savePath)) {
      fs.mkdirSync(this.savePath, { recursive: true });
    }
  }

  private getMetadataFromFile(filePath: string): Metadata | null {
    try {
      const buffer = fs.readFileSync(filePath);
      const separatorIndex = buffer.lastIndexOf(this.SEPARATOR);
      if (separatorIndex === -1) return null;
      return JSON.parse(buffer.subarray(separatorIndex + this.SEPARATOR.length).toString('utf8'));
    } catch {
      return null;
    }
  }

  private getFilePathForKey(key: string): string | null {
    try {
      const files = fs.readdirSync(this.savePath);
      for (const file of files) {
        const filePath = path.join(this.savePath, file);
        const metadata = this.getMetadataFromFile(filePath);
        if (metadata?.url === key) return filePath;
      }
    } catch {
      return null;
    }
    return null;
  }

  get(key: string): Buffer {
    const filePath = this.getFilePathForKey(key);
    if (!filePath) throw new Error(`Image not found: ${key}`);
    const buffer = fs.readFileSync(filePath);
    const separatorIndex = buffer.lastIndexOf(this.SEPARATOR);
    return buffer.subarray(0, separatorIndex);
  }

  getBase64(key: string): string {
    const filePath = this.getFilePathForKey(key);
    if (!filePath) throw new Error(`Image not found: ${key}`);
    const buffer = fs.readFileSync(filePath);
    const metadata = this.getMetadataFromFile(filePath);
    if (!metadata) throw new Error(`Metadata not found: ${key}`);
    const separatorIndex = buffer.lastIndexOf(this.SEPARATOR);
    const imageBuffer = buffer.subarray(0, separatorIndex);
    return `data:${metadata.contentType};base64,${imageBuffer.toString("base64")}`;
  }

  set(key: string, buffer: Buffer, contentType: string): void {
    const hash = createHash('md5').update(buffer).digest('hex');
    const metadata: Metadata = {
      url: key,
      size: buffer.length,
      hash,
      contentType,
      createdAt: Date.now(),
    };

    const extension = contentType.split('/')[1] || 'jpg';
    const fileName = `${hash}.${extension}`;
    const filePath = path.join(this.savePath, fileName);

    const metadataBuffer = Buffer.from(JSON.stringify(metadata));
    const finalBuffer = Buffer.concat([buffer, this.SEPARATOR, metadataBuffer]);

    try {
      fs.writeFileSync(filePath, finalBuffer);
    } catch (error) {
      console.error("Error writing file:", error);
      throw error;
    }
  }

  has(key: string): boolean {
    return this.getFilePathForKey(key) !== null;
  }

  delete(key: string): void {
    const filePath = this.getFilePathForKey(key);
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
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
    } catch (error) {
      console.error("Error clearing cache:", error);
      throw error;
    }
  }

  keys(): string[] {
    const keys: string[] = [];
    fs.readdirSync(this.savePath).forEach(file => {
      const filePath = path.join(this.savePath, file);
      const metadata = this.getMetadataFromFile(filePath);
      if (metadata?.url) keys.push(metadata.url);
    });
    return keys;
  }
}

const imageCache = new ImageCache(path.join(__dirname, "../../data/cache/downloadImage"));

/**
 * 从URL获取图片的base64编码
 * @param url 图片的URL
 * @param cacheKey 指定缓存键，没有就用URL
 * @param [ignoreCache=false] 是否忽略缓存
 *
 * @returns 图片的base64编码，包括base64前缀
 **/
export async function convertUrltoBase64(url: string, cacheKey?: string, ignoreCache = false): Promise<string> {
  url = url.replace(/&amp;/g, "&");

  cacheKey = cacheKey ?? url;

  if (!ignoreCache && imageCache.has(cacheKey)) {
    return imageCache.getBase64(cacheKey);
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
    let buffer = Buffer.from(response.data);
    const contentType = response.headers["content-type"] || "image/jpeg";
    buffer = await compressImage(buffer);
    imageCache.set(cacheKey, buffer, contentType);
    const base64 = `data:${contentType};base64,${buffer.toString("base64")}`;
    return base64;
  } catch (error) {
    console.error("Error converting image to base64:", error.message);
    return "";
  }
}

// 去除base64前缀
export function removeBase64Prefix(base64: string): string {
  return base64.replace(/^data:image\/(jpg|jpeg|png|webp|gif|bmp|tiff|ico|avif|webm|apng|svg);base64,/, "");
}
