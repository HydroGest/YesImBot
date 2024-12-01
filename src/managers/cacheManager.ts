import path from "path";
import fs from "fs";

export class CacheManager {
  private cache: Map<string, any> = new Map();

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get(key: string): any {
    return this.cache.get(key);
  }

  set(key: string, value: any): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getFilePath(model: string, key: string): string {
    const modelDir = path.join(this.cacheDir, model);
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }
    const safeKey = key.slice(0, 100);
    return path.join(modelDir, `${safeKey}.json`);
  }

  save(model: string, key: string, data: unknown): void {
    const filePath = this.getFilePath(model, key);
    fs.writeFileSync(filePath, JSON.stringify(data));
  }

  load<T>(model: string, key: string): T | null {
    const filePath = this.getFilePath(model, key);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
      } catch (error) {
        console.warn(`Failed to read cache: ${filePath}`, error);
        return null;
      }
    }
    return null;
  }
}

// 缓存相关 考虑把它们放到一个单独的文件中 这样做基于md5的图片缓存的时候也可以用到
export function getCacheDir(): string {
  const cacheDir = path.join(__dirname, "../../data/.vector_cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

export function getCacheFileName(model: string, text: string): string {
  // 创建模型专用的子目录
  const modelDir = path.join(getCacheDir(), model);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  const safeText = text.slice(0, 100);

  return path.join(modelDir, `${safeText}.json`);
}
export function saveToCache(fileName: string, vector: number[]): void {
  // 确保目标目录存在
  const dir = path.dirname(fileName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fileName, JSON.stringify(vector));
}

export function loadFromCache(fileName: string): number[] | null {
  if (fs.existsSync(fileName)) {
    try {
      return JSON.parse(fs.readFileSync(fileName, "utf-8"));
    } catch (error) {
      console.warn(`读取缓存文件失败: ${fileName}`, error);
      return null;
    }
  }
  return null;
}

export const cacheManager = new CacheManager(
  path.join(__dirname, "../../data/cache")
);
