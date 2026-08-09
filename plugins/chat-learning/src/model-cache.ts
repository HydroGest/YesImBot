import { createHash } from "node:crypto";

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

export class ModelCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  public constructor(private readonly ttlMs = 30 * 60 * 1000) {}

  public key(parts: readonly unknown[]): string {
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }

  public get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  public set<T>(key: string, value: T): void {
    this.entries.set(key, { expiresAt: Date.now() + this.ttlMs, value });
  }

  public async getOrProduce<T>(key: string, produce: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await produce();
    if (value !== undefined) this.set(key, value);
    return value;
  }

  public clear(): void {
    this.entries.clear();
  }
}

export function modelCacheId(model: unknown): string {
  if (typeof model !== "object" || model === null) return "unknown";
  const modelId = (model as { modelId?: unknown }).modelId;
  return typeof modelId === "string" ? modelId : "unknown";
}
