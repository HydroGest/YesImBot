import type { NormalizedUsage, TokenCounts, UsageRow } from "./types.js";

export function emptyTokenCounts(): TokenCounts {
  return { calls: 0, inputTokens: 0, outputTokens: 0, noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function getLocalDateNumber(date: Date = new Date()): number {
  return Math.floor((date.valueOf() / 60_000 - date.getTimezoneOffset()) / 1440);
}

export function addRow(target: TokenCounts, row: UsageRow): void {
  target.calls += row.calls;
  target.inputTokens += row.inputTokens;
  target.outputTokens += row.outputTokens;
  target.noCacheTokens += row.noCacheTokens;
  target.cacheReadTokens += row.cacheReadTokens;
  target.cacheWriteTokens += row.cacheWriteTokens;
}

export function addUsage(target: TokenCounts, usage: NormalizedUsage): void {
  target.calls += 1;
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.noCacheTokens += usage.noCacheTokens;
  target.cacheReadTokens += usage.cacheReadTokens;
  target.cacheWriteTokens += usage.cacheWriteTokens;
}

export function averageCounts(target: TokenCounts, days: number): TokenCounts {
  const divisor = Math.max(1, days);
  return {
    calls: target.calls / divisor,
    inputTokens: target.inputTokens / divisor,
    outputTokens: target.outputTokens / divisor,
    noCacheTokens: target.noCacheTokens / divisor,
    cacheReadTokens: target.cacheReadTokens / divisor,
    cacheWriteTokens: target.cacheWriteTokens / divisor,
  };
}
