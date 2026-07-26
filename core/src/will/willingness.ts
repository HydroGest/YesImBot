import type { Element, Universal } from "koishi";

import { isMessage, type Input, type Message } from "../event/index.js";
import type { WillEngine } from "./index.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;

export interface WillingnessConfig {
  readonly base: { readonly text: number };
  readonly attribute: { readonly atMention: number; readonly isDirectMessage: number };
  readonly interest: {
    readonly keywords: readonly string[];
    readonly keywordMultiplier: number;
    readonly defaultMultiplier: number;
  };
  readonly lifecycle: {
    readonly maxWillingness: number;
    readonly decayHalfLifeSeconds: number;
    readonly probabilityThreshold: number;
    readonly probabilityAmplifier: number;
    readonly replyCost: number;
  };
}

export interface WillingnessConfigInput {
  readonly base?: Partial<WillingnessConfig["base"]>;
  readonly attribute?: Partial<WillingnessConfig["attribute"]>;
  readonly interest?: Partial<WillingnessConfig["interest"]>;
  readonly lifecycle?: Partial<WillingnessConfig["lifecycle"]>;
}

export interface WillingnessWillOptions {
  readonly config: WillingnessConfig;
  readonly now: () => number;
  readonly random: () => number;
  readonly warn: (event: string, fields: Record<string, unknown>) => void;
}

export class WillingnessWillEngine implements WillEngine {
  private readonly config: WillingnessConfig;
  private score = 0;
  private lastMessageAt: number | null = null;
  private lastDecayAt: number | null = null;

  constructor(private readonly options: WillingnessWillOptions) {
    this.config = snapshotConfig(options.config);
  }

  async decide(input: Input, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";

    try {
      const now = this.options.now();
      const decayedScore =
        this.lastDecayAt === null || this.lastMessageAt === null
          ? this.score
          : decayScore(this.score, this.lastDecayAt, this.lastMessageAt, now, this.config);
      const nextScore = calculateScore(decayedScore, input.data, this.config);
      const probability = calculateProbability(nextScore, this.config.lifecycle);
      const decision = this.options.random() < probability ? "trigger" : "wait";

      this.score = nextScore;
      this.lastMessageAt = now;
      this.lastDecayAt = now;
      return decision;
    } catch (cause) {
      this.warn(cause);
      return "wait";
    }
  }

  async onReply(): Promise<void> {
    try {
      assertValidConfig(this.config);
      this.score = Math.max(0, this.score - this.config.lifecycle.replyCost);
    } catch (cause) {
      this.warn(cause);
    }
  }

  private warn(cause: unknown): void {
    try {
      this.options.warn("will.willingness.calculation_failed", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {}
  }
}

export function createWillingnessConfig(config: WillingnessConfigInput = {}): WillingnessConfig {
  return snapshotConfig({
    base: { text: 12, ...config.base },
    attribute: { atMention: 100, isDirectMessage: 40, ...config.attribute },
    interest: {
      keywords: [],
      keywordMultiplier: 1.2,
      defaultMultiplier: 1,
      ...config.interest,
    },
    lifecycle: {
      maxWillingness: 100,
      decayHalfLifeSeconds: 600,
      probabilityThreshold: 55,
      probabilityAmplifier: 0.04,
      replyCost: 35,
      ...config.lifecycle,
    },
  });
}

export function decayScore(
  score: number,
  lastDecayAt: number,
  lastMessageAt: number,
  now: number,
  config: WillingnessConfig,
): number {
  assertValidConfig(config);
  if (![score, lastDecayAt, lastMessageAt, now].every(Number.isFinite) || now < lastDecayAt) {
    throw new TypeError("Invalid willingness decay state");
  }

  const weightedSeconds = weightedSilenceSeconds(lastDecayAt, lastMessageAt, now);
  const { decayHalfLifeSeconds, probabilityThreshold } = config.lifecycle;
  const decayed =
    score > probabilityThreshold && probabilityThreshold > 0
      ? decayHighScore(score, weightedSeconds, probabilityThreshold, decayHalfLifeSeconds)
      : score * 0.5 ** (weightedSeconds / decayHalfLifeSeconds);

  return decayed < 0.01 ? 0 : Math.max(0, decayed);
}

function snapshotConfig(config: WillingnessConfig): WillingnessConfig {
  return Object.freeze({
    base: Object.freeze({ ...config.base }),
    attribute: Object.freeze({ ...config.attribute }),
    interest: Object.freeze({
      ...config.interest,
      keywords: Object.freeze([...config.interest.keywords]),
    }),
    lifecycle: Object.freeze({ ...config.lifecycle }),
  });
}

function weightedSilenceSeconds(lastDecayAt: number, lastMessageAt: number, now: number): number {
  const hotEnd = lastMessageAt + 15_000;
  const warmEnd = lastMessageAt + 60_000;
  const overlapSeconds = (start: number, end: number) =>
    Math.max(0, Math.min(now, end) - Math.max(lastDecayAt, start)) / 1_000;

  return (
    overlapSeconds(lastMessageAt, hotEnd) * 0.3 +
    overlapSeconds(hotEnd, warmEnd) * 0.7 +
    Math.max(0, now - Math.max(lastDecayAt, warmEnd)) / 1_000
  );
}

function decayHighScore(
  score: number,
  weightedSeconds: number,
  threshold: number,
  halfLife: number,
): number {
  const weightedSecondsToThreshold = 2 * halfLife * Math.log2(score / threshold);
  if (weightedSeconds <= weightedSecondsToThreshold) {
    return score * 0.5 ** ((0.5 * weightedSeconds) / halfLife);
  }
  return threshold * 0.5 ** ((weightedSeconds - weightedSecondsToThreshold) / halfLife);
}

function calculateScore(current: number, data: Message["data"], config: WillingnessConfig): number {
  assertValidConfig(config);
  const multiplier = config.interest.keywords.some((keyword) => data.text.includes(keyword))
    ? config.interest.keywordMultiplier
    : config.interest.defaultMultiplier;
  const attributes =
    (isSelfMention(data.selfId, data.elements) ? config.attribute.atMention : 0) +
    (data.channel.type === DIRECT_CHANNEL_TYPE ? config.attribute.isDirectMessage : 0);
  const rawGain = (config.base.text + attributes) * multiplier;
  const ratio = current / config.lifecycle.maxWillingness;
  const marginalGain = Math.max(0, 1 - ratio ** 2);
  const dynamicGain = dynamicGainMultiplier(ratio);

  return Math.min(
    config.lifecycle.maxWillingness,
    Math.max(0, current + rawGain * marginalGain * dynamicGain),
  );
}

function calculateProbability(score: number, lifecycle: WillingnessConfig["lifecycle"]): number {
  if (score <= lifecycle.probabilityThreshold) return 0;
  return Math.min(
    1,
    Math.max(0, (score - lifecycle.probabilityThreshold) * lifecycle.probabilityAmplifier),
  );
}

function dynamicGainMultiplier(ratio: number): number {
  if (ratio < 0.2) return 1;
  if (ratio < 0.8) return Math.max(1, -(((ratio - 0.5) * 2) ** 2) + 2);
  return 1 - (ratio - 0.8) / 0.2;
}

function isSelfMention(selfId: string, elements: readonly Element[] | undefined): boolean {
  return (
    elements?.some((element) => element.type === "at" && String(element.attrs.id) === selfId) ??
    false
  );
}

function assertValidConfig(config: WillingnessConfig): void {
  const values = [
    config.base.text,
    config.attribute.atMention,
    config.attribute.isDirectMessage,
    config.interest.keywordMultiplier,
    config.interest.defaultMultiplier,
    config.lifecycle.maxWillingness,
    config.lifecycle.decayHalfLifeSeconds,
    config.lifecycle.probabilityThreshold,
    config.lifecycle.probabilityAmplifier,
    config.lifecycle.replyCost,
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    config.lifecycle.maxWillingness <= 0 ||
    config.lifecycle.decayHalfLifeSeconds <= 0 ||
    config.lifecycle.probabilityThreshold < 0 ||
    config.lifecycle.probabilityAmplifier < 0
  ) {
    throw new TypeError("Invalid willingness configuration");
  }
}
