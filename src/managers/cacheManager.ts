import fs from "fs";

export class CacheManager<T> {
  private cache: Map<string, T>; // 内存缓存
  private dirtyCache: Map<string, T>; // 临时缓存
  private filePath: string;
  private isDirty: boolean; // 标记是否有需要保存的数据
  private saveImmediately: boolean;
  private timer: NodeJS.Timeout;

  constructor(filePath: string) {
    this.cache = new Map<string, T>();
    this.dirtyCache = new Map<string, T>();
    this.isDirty = false;
    this.filePath = filePath;
    this.saveImmediately = true;
    this.loadCache();

    // 监听退出事件，确保退出前保存数据
    process.on("exit", this.commit.bind(this));
    process.on("SIGINT", this.handleExit.bind(this));
    process.on("SIGTERM", this.handleExit.bind(this));
    process.on("beforeExit", this.commit.bind(this));
  }

  private serialize(value: T): string {
    if (value instanceof Map) {
      // 序列化 Map
      return JSON.stringify({
        type: "Map",
        value: Array.from(value.entries()),
      });
    } else if (value instanceof Set) {
      // 序列化 Set
      return JSON.stringify({
        type: "Set",
        value: Array.from(value),
      });
    } else if (value instanceof Date) {
      // 序列化 Date
      return JSON.stringify({
        type: "Date",
        value: value.toISOString(),
      });
    } else {
      // 默认使用 JSON 序列化
      return JSON.stringify(value);
    }
  }

  private deserialize(serialized: string): T {
    const parsed = JSON.parse(serialized);
    if (parsed && parsed.type === "Map") {
      return new Map(parsed.value) as unknown as T; // 恢复 Map
    } else if (parsed && parsed.type === "Set") {
      return new Set(parsed.value) as unknown as T; // 恢复 Set
    } else if (parsed && parsed.type === "Date") {
      return new Date(parsed.value) as unknown as T; // 恢复 Date
    } else {
      return parsed as T; // 默认返回原始对象
    }
  }

  // 序列化并存储数据到文件
  private saveCache(): void {
    const serializedData = JSON.stringify(
      Array.from(this.cache.entries()).map(([key, value]) => [key, this.serialize(value)]),
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
        const entries: [string, string][] = JSON.parse(serializedData);
        entries.forEach(([key, value]) => {
          this.cache.set(key, this.deserialize(value));
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

  public entries(): [string, T][] {
    return Array.from(this.cache.entries());
  }

  private markDirty(key: string, value: T): void {
    this.dirtyCache.set(key, value);
    this.isDirty = true;
  }

  // 添加数据到缓存
  public set(key: string, value: T): void {
    this.cache.set(key, value);
    if (this.saveImmediately) {
      this.saveCache();
      return;
    }
    this.markDirty(key, value);
  }

  // 从缓存中获取数据
  public get(key: string): T | undefined {
    return this.cache.get(key);
  }

  // 移除缓存中的数据
  public remove(key: string): void {
    this.cache.delete(key);
    if (this.saveImmediately) {
      this.saveCache();
      return;
    }
    this.dirtyCache.delete(key);
    this.isDirty = true;
  }

  // 清空缓存
  public clear(): void {
    this.cache.clear();
    if (this.saveImmediately) {
      this.saveCache();
      return;
    }
    this.dirtyCache.clear();
    this.isDirty = true;
  }

  // 统一提交缓存到文件
  public commit(): void {
    if (this.isDirty) {
      // 将内存缓存合并到文件缓存
      this.dirtyCache.forEach((value, key) => {
        this.cache.set(key, value);
      });
      this.saveCache();
      this.dirtyCache.clear();
      this.isDirty = false;
    }
  }

  // 在定时器中定期保存缓存
  public autoSave(interval: number = 5000): void {
    this.saveImmediately = false;
    this.timer = setInterval(() => {
      if (this.isDirty) {
        this.commit();
      }
    }, interval);
  }

  private handleExit(): void {
    this.commit(); // 在退出前统一保存数据
    clearInterval(this.timer);
    process.exit(); // 确保进程退出
  }
}
