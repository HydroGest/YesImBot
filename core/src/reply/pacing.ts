import type { PacingConfig } from "../config.js";

const MIN_DELAY_MS = 250;
const MAX_SEGMENT_DELAY_MS = 10_000;
const JITTER_MIN = 0.85;
const JITTER_MAX = 1.15;

export interface PacingInput {
  readonly text: string;
  readonly consumedDeliveryMs: number;
  readonly config: PacingConfig;
}

export function nextSegmentDelayMs(input: PacingInput): number {
  const jitter = JITTER_MIN + (JITTER_MAX - JITTER_MIN) * Math.random();
  const typingMs = ([...input.text].length / input.config.charactersPerSecond) * 1_000 * jitter;
  const delayMs = Math.min(Math.max(typingMs, MIN_DELAY_MS), MAX_SEGMENT_DELAY_MS);
  if (input.consumedDeliveryMs + delayMs >= input.config.maxTotalDelayMs) return MIN_DELAY_MS;
  return Math.round(delayMs);
}
