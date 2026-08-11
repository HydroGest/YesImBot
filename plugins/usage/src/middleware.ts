import type { NormalizedUsage } from "./types.js";

interface RawUsageInput {
  inputTokens?: number | { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: number | { total?: number; text?: number; reasoning?: number };
  cachedInputTokens?: number;
}

export function normalizeLanguageUsage(usage: unknown): NormalizedUsage {
  const raw = (usage ?? {}) as RawUsageInput;
  const input = raw.inputTokens;
  const output = raw.outputTokens;
  const inputDetail = typeof input === "object" && input !== null ? input : undefined;
  const outputDetail = typeof output === "object" && output !== null ? output : undefined;
  const inputTokens = inputDetail ? toNumber(inputDetail.total) : toNumber(input);
  const cacheReadTokens = inputDetail ? toNumber(inputDetail.cacheRead) : toNumber(raw.cachedInputTokens);
  const cacheWriteTokens = inputDetail ? toNumber(inputDetail.cacheWrite) : 0;
  const explicitNoCacheTokens = inputDetail ? toNumber(inputDetail.noCache) : 0;
  const noCacheTokens = explicitNoCacheTokens > 0 ? explicitNoCacheTokens : Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);

  return { inputTokens, outputTokens: outputDetail ? toNumber(outputDetail.total) : toNumber(output), noCacheTokens, cacheReadTokens, cacheWriteTokens };
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
