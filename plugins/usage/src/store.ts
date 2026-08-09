import { $, type Context } from "koishi";

import { addRow, averageCounts, emptyTokenCounts, getLocalDateNumber } from "./aggregate.js";
import type {
  NormalizedUsage,
  RateSnapshot,
  TokenCounts,
  UsageByModel,
  UsageConfig,
  UsageHistorySnapshot,
  UsageHistorySource,
  UsagePayload,
  UsageRecordInput,
  UsageRow,
} from "./types.js";

type UsageDatabase = Pick<Context["database"], "select" | "upsert">;

export class RateWindow {
  private readonly input: number[];
  private readonly output: number[];
  private readonly noCache: number[];
  private readonly cacheRead: number[];

  public constructor(seconds = 60) {
    const length = Math.max(1, seconds);
    this.input = new Array(length).fill(0);
    this.output = new Array(length).fill(0);
    this.noCache = new Array(length).fill(0);
    this.cacheRead = new Array(length).fill(0);
  }

  public tick(): void {
    this.input.unshift(0);
    this.output.unshift(0);
    this.noCache.unshift(0);
    this.cacheRead.unshift(0);
    this.input.pop();
    this.output.pop();
    this.noCache.pop();
    this.cacheRead.pop();
  }

  public add(usage: NormalizedUsage): void {
    this.input[0] += usage.inputTokens;
    this.output[0] += usage.outputTokens;
    this.noCache[0] += usage.noCacheTokens;
    this.cacheRead[0] += usage.cacheReadTokens;
  }

  public snapshot(): RateSnapshot {
    const inputPerMinute = this.sum(this.input);
    const outputPerMinute = this.sum(this.output);
    return {
      inputPerMinute,
      outputPerMinute,
      totalPerMinute: inputPerMinute + outputPerMinute,
      noCachePerMinute: this.sum(this.noCache),
      cacheReadPerMinute: this.sum(this.cacheRead),
    };
  }

  private sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0);
  }
}

export class DatabaseUsageHistory implements UsageHistorySource {
  public constructor(private readonly database: UsageDatabase) {}

  public async scan(config: UsageConfig): Promise<UsageHistorySnapshot> {
    const today = getLocalDateNumber();
    const startDate = today - config.recentDayCount;
    const rows = (await this.database.select("yesimbot.usage", { date: { $gte: startDate } }).execute()) as UsageRow[];

    const recent: Array<TokenCounts & { date: number }> = Array.from({ length: config.recentDayCount + 1 }, (_, index) => ({
      date: today - index,
      ...emptyTokenCounts(),
    }));
    const byHour: Array<TokenCounts & { hour: number }> = Array.from({ length: 24 }, (_, hour) => ({ hour, ...emptyTokenCounts() }));

    for (const row of rows) {
      const counts = recent[today - row.date];
      if (counts) addRow(counts, row);
      addRow(byHour[row.hour], row);
    }

    return { recent, byHour: byHour.map((entry) => ({ hour: entry.hour, ...averageCounts(entry, config.recentDayCount) })) };
  }
}

export class UsageStore {
  private readonly rate: RateWindow;
  private readonly history: UsageHistorySource;
  private tail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly database: UsageDatabase,
    rateWindowSeconds: number,
    history: UsageHistorySource = new DatabaseUsageHistory(database),
  ) {
    this.rate = new RateWindow(rateWindowSeconds);
    this.history = history;
  }

  public record(input: UsageRecordInput): void {
    const now = new Date();
    this.rate.add(input.usage);
    const row: UsageRow = {
      date: getLocalDateNumber(now),
      hour: now.getHours(),
      provider: input.providerId,
      model: input.modelId,
      kind: input.kind,
      calls: 1,
      ...input.usage,
    };
    void this.enqueueUpsert(row).catch(() => undefined);
  }

  public tickRate(): void {
    this.rate.tick();
  }

  public async snapshot(config: UsageConfig): Promise<UsagePayload> {
    const today = getLocalDateNumber();
    const startDate = today - config.recentDayCount;
    const rows = (await this.database.select("yesimbot.usage", { date: { $gte: startDate } }).execute()) as UsageRow[];

    const todayCounts = emptyTokenCounts();
    const byModel = new Map<string, UsageByModel>();

    for (const row of rows) {
      if (row.date === today) addRow(todayCounts, row);

      const key = `${row.kind}:${row.provider}:${row.model}`;
      const modelEntry = byModel.get(key) ?? { model: `${row.provider}:${row.model}`, kind: row.kind, counts: emptyTokenCounts() };
      addRow(modelEntry.counts, row);
      byModel.set(key, modelEntry);
    }

    const history = await this.history.scan(config);
    return {
      today: todayCounts,
      recent: history.recent,
      byHour: history.byHour,
      byModel: [...byModel.values()]
        .sort((left, right) => left.counts.inputTokens + left.counts.outputTokens - (right.counts.inputTokens + right.counts.outputTokens))
        .reverse(),
      rate: this.rate.snapshot(),
    };
  }

  private enqueueUpsert(row: UsageRow): Promise<void> {
    const task = this.tail.then(async () => {
      await this.database.upsert("yesimbot.usage", (existing) => [
        {
          ...row,
          calls: $.add($.ifNull(existing.calls, 0), row.calls),
          inputTokens: $.add($.ifNull(existing.inputTokens, 0), row.inputTokens),
          outputTokens: $.add($.ifNull(existing.outputTokens, 0), row.outputTokens),
          noCacheTokens: $.add($.ifNull(existing.noCacheTokens, 0), row.noCacheTokens),
          cacheReadTokens: $.add($.ifNull(existing.cacheReadTokens, 0), row.cacheReadTokens),
          cacheWriteTokens: $.add($.ifNull(existing.cacheWriteTokens, 0), row.cacheWriteTokens),
        },
      ]);
    });
    this.tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
}

export { emptyTokenCounts, getLocalDateNumber } from "./aggregate.js";
