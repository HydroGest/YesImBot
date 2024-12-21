import fs from "fs";
import path from "path";

import BSON from "bson";

// TODO: 允许自己指定缓存路径
// TODO: 使用 zlib 进行压缩
export class CacheManager<T> {
  private cache: Map<string, T>; // 内存缓存
  private dirtyCache: Map<string, T>; // 临时缓存
  private isDirty: boolean; // 标记是否有需要保存的数据
  private saveImmediately: boolean;
  private timer: NodeJS.Timeout;

  constructor(
    private filePath: string,
    private enableBson = false
  ) {
    this.cache = new Map<string, T>();
    this.dirtyCache = new Map<string, T>();
    this.isDirty = false;
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

  /**
   * 序列化并存储数据到文件
   * @returns
   */
  private async saveCache(): Promise<void> {
    try {
      // 确保目标目录存在
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });

      if (this.enableBson) {
        const serializedData = BSON.serialize(Object.fromEntries(this.cache));
        await fs.promises.writeFile(this.filePath, serializedData);
        return;
      }

      const serializedData = JSON.stringify(
        Array.from(this.cache.entries()).map(([key, value]) => [key, this.serialize(value)]),
        null,
        2
      );
      await fs.promises.writeFile(this.filePath, serializedData, "utf-8");
    } catch (error) {
      const llogger = logger || console;
      llogger.error("Failed to save cache:", error);
      // 不抛出错误，避免中断定时器
      // 下次保存时会重试
    }
  }

  /**
   * 反序列化并加载缓存数据
   * @returns
   */
  private async loadCache(): Promise<void> {
    try {
      if (!fs.existsSync(this.filePath)) {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        if (this.enableBson) {
          await fs.promises.writeFile(this.filePath, BSON.serialize(this.cache));
        } else {
          await fs.promises.writeFile(this.filePath, "[]", "utf-8");
        }
        return;
      }

      if (this.enableBson) {
        const serializedData = await fs.promises.readFile(this.filePath);
        const entries: { [key: string]: T } = BSON.deserialize(serializedData);
        Object.entries(entries).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        return;
      }

      const serializedData = await fs.promises.readFile(this.filePath, "utf-8");
      const entries: [string, string][] = JSON.parse(serializedData);
      entries.forEach(([key, value]) => {
        this.cache.set(key, this.deserialize(value));
      });
    } catch (error) {
      const llogger = logger || console;
      llogger.warn("加载缓存失败:", error);
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
  public async set(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    if (this.saveImmediately) {
      await this.saveCache();
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
  public async commit(): Promise<void> {
    if (this.isDirty) {
      // 将内存缓存合并到文件缓存
      this.dirtyCache.forEach((value, key) => {
        this.cache.set(key, value);
      });
      await this.saveCache();
      this.dirtyCache.clear();
      this.isDirty = false;
    }
  }

  /**
   * 在定时器中定期保存缓存
   * @param interval
   * @returns
   */
  public setAutoSave(interval: number = 5000): void {
    if (interval <= 0) {
      this.saveImmediately = true;
      this.timer && clearTimeout(this.timer); // 清除现有的定时器
      return;
    }

    this.saveImmediately = false;

    const autoSave = async () => {
      if (this.isDirty) {
        await this.commit(); // 异步保存缓存
      }
      this.timer = setTimeout(autoSave, interval); // 递归调用自身
    };

    this.timer && clearTimeout(this.timer); // 清除现有的定时器
    this.timer = setTimeout(autoSave, interval); // 启动新的定时器
  }

  private handleExit(): void {
    this.commit().then(() => {
      clearTimeout(this.timer!);
      process.exit(); // 确保进程退出
    });
  }
}
