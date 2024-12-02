import fs from "fs";

export class CacheManager<T> {
  private cache: Map<string, T>;
  private filePath: string;

  constructor(filePath: string) {
    this.cache = new Map<string, T>();
    this.filePath = filePath;
    this.loadCache();
  }

  // 序列化并存储数据到缓存
  private saveCache(): void {
    const serializedData = JSON.stringify(
      Array.from(this.cache.entries()),
      null,
      2
    );
    fs.writeFileSync(this.filePath, serializedData, "utf-8");
  }

  // 反序列化并加载缓存数据
  private loadCache(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const serializedData = fs.readFileSync(this.filePath, "utf-8");
        const entries: [string, T][] = JSON.parse(serializedData);
        entries.forEach(([key, value]) => {
          this.cache.set(key, value);
        });
      }
    } catch (error) {
      console.error("加载缓存失败:", error);
    }
  }

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public keys(): string[] {
    return Array.from(this.cache.keys());
  }

  // 添加数据到缓存
  public set(key: string, value: T): void {
    this.cache.set(key, value);
    this.saveCache();
  }

  // 从缓存中获取数据
  public get(key: string): T | undefined {
    return this.cache.get(key);
  }

  // 移除缓存中的数据
  public remove(key: string): void {
    this.cache.delete(key);
    this.saveCache();
  }

  // 清空缓存
  public clear(): void {
    this.cache.clear();
    this.saveCache();
  }
}
