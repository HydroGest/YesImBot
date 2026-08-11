import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Logger } from "koishi";

import { quotaDayKey, type QuotaNotificationRecord, type QuotaOverride, type QuotaUsageRecord, type ScopeUsage } from "./quota-types.js";

type OverridesData = Record<string, QuotaOverride>;

export class QuotaStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly overrides = new Map<string, QuotaOverride>();
  private overridesLoaded = false;
  private readonly dayCache = new Map<string, Map<string, ScopeUsage>>();
  private readonly notificationCounts = new Map<string, Map<string, number>>();

  public constructor(
    private readonly directory: string,
    private readonly logger: Logger,
  ) {}

  public async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  public append(record: QuotaUsageRecord): Promise<void> {
    return this.serialize(async () => {
      const day = quotaDayKey(new Date(record.t));
      this.dayCache.delete(day);
      await mkdir(this.directory, { recursive: true });
      await appendFile(this.usagePath(day), `${JSON.stringify(record)}\n`, "utf8");
    });
  }

  public async cachedToday(): Promise<Map<string, ScopeUsage>> {
    const day = quotaDayKey();
    const cached = this.dayCache.get(day);
    if (cached) return cached;
    const fresh = await this.readDay(day);
    this.dayCache.set(day, fresh);
    return fresh;
  }

  public readDay(day = quotaDayKey()): Promise<Map<string, ScopeUsage>> {
    return this.serialize(async () => {
      const result = new Map<string, ScopeUsage>();
      let content = "";
      try {
        content = await readFile(this.usagePath(day), "utf8");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return result;
        throw cause;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as QuotaUsageRecord;
          const current = result.get(record.scope);
          if (current) {
            current.inputTokens += record.inputTokens;
            current.outputTokens += record.outputTokens;
            current.totalTokens += record.totalTokens;
            current.calls += 1;
            current.model = record.model || current.model;
            current.kindTokens[record.kind] = (current.kindTokens[record.kind] ?? 0) + record.totalTokens;
          } else {
            result.set(record.scope, {
              scope: record.scope,
              platform: record.platform,
              channelId: record.channelId,
              isDirect: record.isDirect,
              model: record.model,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              totalTokens: record.totalTokens,
              calls: 1,
              kindTokens: { [record.kind]: record.totalTokens },
            });
          }
        } catch {
          this.logger.warn("quota.skip_bad_line", { day, line: line.slice(0, 200) });
        }
      }
      return result;
    });
  }

  public getOverride(scope: string): Promise<QuotaOverride | undefined> {
    return this.serialize(async () => {
      await this.loadOverrides();
      return this.overrides.get(scope);
    });
  }

  public setOverride(scope: string, patch: QuotaOverride): Promise<QuotaOverride> {
    return this.serialize(async () => {
      await this.loadOverrides();
      const current = { ...(this.overrides.get(scope) ?? {}), ...patch };
      this.overrides.set(scope, current);
      await this.saveOverrides();
      return current;
    });
  }

  public clearOverride(scope: string, field?: keyof QuotaOverride): Promise<void> {
    return this.serialize(async () => {
      await this.loadOverrides();
      if (!field) {
        this.overrides.delete(scope);
      } else {
        const current = this.overrides.get(scope);
        if (!current) return;
        delete current[field];
        if (Object.keys(current).length === 0) this.overrides.delete(scope);
      }
      await this.saveOverrides();
    });
  }

  public getTodayNotificationCount(scope: string): Promise<number> {
    return this.serialize(async () => (await this.loadNotificationCounts(quotaDayKey())).get(scope) ?? 0);
  }

  public appendNotification(record: QuotaNotificationRecord): Promise<void> {
    return this.serialize(async () => {
      const day = quotaDayKey(new Date(record.t));
      const counts = await this.loadNotificationCounts(day);
      await appendFile(this.notificationPath(day), `${JSON.stringify(record)}\n`, "utf8");
      counts.set(record.scope, (counts.get(record.scope) ?? 0) + 1);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private usagePath(day: string): string {
    return join(this.directory, `usage-${day}.jsonl`);
  }

  private notificationPath(day: string): string {
    return join(this.directory, `notifications-${day}.jsonl`);
  }

  private overridesPath(): string {
    return join(this.directory, "overrides.json");
  }

  private async loadOverrides(): Promise<void> {
    if (this.overridesLoaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.overridesPath(), "utf8")) as OverridesData;
      for (const [key, value] of Object.entries(parsed)) {
        if (value && typeof value === "object") this.overrides.set(key, value);
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn("quota.load_overrides_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    this.overridesLoaded = true;
  }

  private async saveOverrides(): Promise<void> {
    const path = this.overridesPath();
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(Object.fromEntries(this.overrides), null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }

  private async loadNotificationCounts(day: string): Promise<Map<string, number>> {
    const cached = this.notificationCounts.get(day);
    if (cached) return cached;
    const counts = new Map<string, number>();
    const content = await readFile(this.notificationPath(day), "utf8").catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return "";
      throw cause;
    });
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as QuotaNotificationRecord;
        if (record.scope) counts.set(record.scope, (counts.get(record.scope) ?? 0) + 1);
      } catch {
        this.logger.warn("quota.skip_bad_notification_line", { day, line: line.slice(0, 200) });
      }
    }
    this.notificationCounts.set(day, counts);
    return counts;
  }
}
