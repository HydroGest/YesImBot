import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { addUsage, averageCounts, emptyTokenCounts, getLocalDateNumber } from "./aggregate.js";
import { normalizeLanguageUsage } from "./middleware.js";
import type { TokenCounts, UsageConfig, UsageHistorySnapshot, UsageHistorySource } from "./types.js";

interface CachedScan {
  key: string;
  value: UsageHistorySnapshot;
}

interface JsonlMessage {
  id?: string;
  data?: { id?: string; timestamp?: number; role?: string; usage?: unknown };
  timestamp?: number;
  type?: string;
}

export class JsonlUsageHistory implements UsageHistorySource {
  private cache: CachedScan | undefined;

  public constructor(private readonly root: string) {}

  public async scan(config: UsageConfig): Promise<UsageHistorySnapshot> {
    const key = await this.cacheKey(config);
    if (this.cache?.key === key) return this.cache.value;

    const today = getLocalDateNumber();
    const startDate = today - config.recentDayCount;
    const recent: Array<TokenCounts & { date: number }> = Array.from({ length: config.recentDayCount + 1 }, (_, index) => ({
      date: today - index,
      ...emptyTokenCounts(),
    }));
    const byHour: Array<TokenCounts & { hour: number }> = Array.from({ length: 24 }, (_, hour) => ({ hour, ...emptyTokenCounts() }));
    const seen = new Set<string>();

    for (const file of await this.files()) {
      const content = await stat(file)
        .then(async (entry) => (entry.isFile() ? readFile(file, "utf8") : ""))
        .catch(() => "");

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const entry = parseJsonlLine(line);
        if (!entry || entry.type !== "message" || entry.data?.role !== "assistant" || entry.data?.usage == null) continue;

        const id = entry.data.id ?? entry.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const timestamp = entry.data.timestamp ?? entry.timestamp;
        if (typeof timestamp !== "number") continue;
        const date = getLocalDateNumber(new Date(timestamp));
        if (date < startDate || date > today) continue;

        const usage = normalizeLanguageUsage(entry.data.usage);
        addUsage(recent[today - date], usage);
        addUsage(byHour[new Date(timestamp).getHours()], usage);
      }
    }

    const value: UsageHistorySnapshot = { recent, byHour: byHour.map((entry) => ({ hour: entry.hour, ...averageCounts(entry, config.recentDayCount) })) };
    this.cache = { key, value };
    return value;
  }

  private async cacheKey(config: UsageConfig): Promise<string> {
    const files = await this.files();
    const parts = [String(config.recentDayCount)];
    for (const file of files) {
      const entry = await stat(file).catch(() => undefined);
      parts.push(`${file}:${entry?.mtimeMs ?? 0}:${entry?.size ?? 0}`);
    }
    return parts.join("|");
  }

  private async files(): Promise<string[]> {
    const result: string[] = [];
    const root = this.root;
    try {
      await this.walk(root, result);
    } catch {
      return result;
    }
    return result;
  }

  private async walk(directory: string, output: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(target, output);
      } else if (entry.name.endsWith(".jsonl")) {
        output.push(target);
      }
    }
  }
}

function parseJsonlLine(line: string): JsonlMessage | undefined {
  try {
    return JSON.parse(line) as JsonlMessage;
  } catch {
    return undefined;
  }
}
