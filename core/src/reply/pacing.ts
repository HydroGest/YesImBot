import type { PacingConfig } from "../config.js";

export interface PacingInput {
  readonly segment: { readonly text: string };
  readonly isFirst: boolean;
  readonly config: PacingConfig;
  readonly elapsedGenerationMs: number;
  readonly consumedDeliveryMs: number;
}

interface PacingLimits {
  readonly minDelayMs: number;
  readonly maxSegmentDelayMs: number;
  readonly maxTotalDelayMs: number;
  readonly cjkCharactersPerSecond: number;
  readonly latinCharactersPerSecond: number;
  readonly randomFactorMin: number;
  readonly randomFactorMax: number;
  readonly firstSegmentResidualMinMs: number;
  readonly firstSegmentResidualMaxMs: number;
}

const CJK_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

export function nextSegmentDelayMs(input: PacingInput): number {
  const limits = normalizeLimits(input.config);
  const random = unitRandom();
  const typingDelayMs = visibleTypingDelayMs(input.segment.text, limits, random);
  const initialDelayMs = input.isFirst
    ? Math.max(
        residualDelayMs(limits, random),
        typingDelayMs - nonNegative(input.elapsedGenerationMs, 0),
      )
    : typingDelayMs;
  const delayMs = clamp(initialDelayMs, limits.minDelayMs, limits.maxSegmentDelayMs);

  if (nonNegative(input.consumedDeliveryMs, 0) + delayMs >= limits.maxTotalDelayMs) {
    return limits.minDelayMs;
  }

  return Math.round(delayMs);
}

function visibleTypingDelayMs(text: string, limits: PacingLimits, random: number): number {
  let cjkCharacters = 0;
  let nonCjkCharacters = 0;

  for (const character of text) {
    if (CJK_CHARACTER.test(character)) {
      cjkCharacters += 1;
    } else {
      nonCjkCharacters += 1;
    }
  }

  const cjkDelayMs = (cjkCharacters / limits.cjkCharactersPerSecond) * 1_000;
  const nonCjkDelayMs = (nonCjkCharacters / limits.latinCharactersPerSecond) * 1_000;
  const randomFactor = interpolate(limits.randomFactorMin, limits.randomFactorMax, random);
  return (cjkDelayMs + nonCjkDelayMs) * randomFactor;
}

function residualDelayMs(limits: PacingLimits, random: number): number {
  return interpolate(limits.firstSegmentResidualMinMs, limits.firstSegmentResidualMaxMs, random);
}

function normalizeLimits(config: PacingConfig): PacingLimits {
  const minDelayMs = nonNegative(config.minDelayMs, 0);
  const maxSegmentDelayMs = Math.max(minDelayMs, nonNegative(config.maxSegmentDelayMs, minDelayMs));
  const maxTotalDelayMs = Math.max(minDelayMs, nonNegative(config.maxTotalDelayMs, minDelayMs));
  const randomFactorMin = nonNegative(config.randomFactorMin, 0);
  const firstSegmentResidualMinMs = nonNegative(config.firstSegmentResidualMinMs, 0);

  return {
    minDelayMs,
    maxSegmentDelayMs,
    maxTotalDelayMs,
    cjkCharactersPerSecond: positive(config.cjkCharactersPerSecond, 1),
    latinCharactersPerSecond: positive(config.latinCharactersPerSecond, 1),
    randomFactorMin,
    randomFactorMax: Math.max(
      randomFactorMin,
      nonNegative(config.randomFactorMax, randomFactorMin),
    ),
    firstSegmentResidualMinMs,
    firstSegmentResidualMaxMs: Math.max(
      firstSegmentResidualMinMs,
      nonNegative(config.firstSegmentResidualMaxMs, firstSegmentResidualMinMs),
    ),
  };
}

function unitRandom(): number {
  const value = Math.random();
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function interpolate(minimum: number, maximum: number, proportion: number): number {
  return minimum + (maximum - minimum) * proportion;
}
