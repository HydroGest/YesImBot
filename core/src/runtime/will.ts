import type { Awaitable, Context, Element, Logger, Universal } from "koishi";

import { isMessage, type Message, type Event } from "../messages.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;
const TEXT_GAIN = 12;
const MENTION_GAIN = 100;
const DIRECT_GAIN = 40;
const MAX_WILLINGNESS = 100;
const PROBABILITY_AMPLIFIER = 0.04;

interface RoutingConfig {
  readonly direct: WillEngine.Decision;
  readonly mention: WillEngine.Decision;
  readonly group: WillEngine.Decision;
}

export interface WillingnessConfig {
  readonly probabilityThreshold: number;
  readonly decayHalfLifeSeconds: number;
  readonly replyCost: number;
}

export type WillConfig = (RoutingConfig & { engine: "routing" }) | (WillingnessConfig & { engine: "willingness" });

export interface WillEngine {
  decide(input: Message | Event, state: WillEngine.State): Awaitable<WillEngine.Decision>;
  onReply?(): Awaitable<void>;
  stop?(): Awaitable<void>;
}

export namespace WillEngine {
  export type Decision = "wait" | "trigger";

  export interface State {
    readonly activeTurnId: string | null;
  }
}

export interface WillEngineObservation {
  readonly event: Message | Event;
  readonly decision: WillEngine.Decision;
}

declare module "koishi" {
  interface Events {
    "yesimbot/will": (observation: WillEngineObservation) => void;
  }
}

export class RoutingWillEngine implements WillEngine {
  private readonly config: RoutingConfig;

  constructor(config: RoutingConfig) {
    this.config = { ...config };
  }

  public async decide(input: Message, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";
    if (input.data.channel.type === DIRECT_CHANNEL_TYPE) return this.config.direct;
    if (isSelfMention(input.data.selfId, input.data.elements)) return this.config.mention;
    return this.config.group;
  }
}

export class WillingnessWillEngine implements WillEngine {
  private readonly ctx: Context;
  private readonly config: WillingnessConfig;
  private readonly logger: Logger;

  private score = 0;
  private lastMessageAt: number | null = null;
  private lastDecayAt: number | null = null;

  constructor(ctx: Context, config: WillingnessConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("will");
  }

  public async decide(input: Message, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";

    try {
      const now = new Date().getTime();
      const decayedScore =
        this.lastDecayAt === null || this.lastMessageAt === null
          ? this.score
          : decayScore(this.score, this.lastDecayAt, this.lastMessageAt, now, this.config);
      const nextScore = calculateScore(decayedScore, input.data);
      const probability = calculateProbability(nextScore, this.config.probabilityThreshold);
      const decision = Math.random() < probability ? "trigger" : "wait";

      this.score = nextScore;
      this.lastMessageAt = now;
      this.lastDecayAt = now;
      return decision;
    } catch (cause) {
      this.logger.warn("Failed to calculate willingness score: %s", cause);
      return "wait";
    }
  }

  public async onReply(): Promise<void> {
    this.score = Math.max(0, this.score - this.config.replyCost);
  }
}

export function createWillEngine(ctx: Context, config: WillConfig): WillEngine {
  if (config?.engine === "willingness") {
    return new WillingnessWillEngine(ctx, config);
  }
  return new RoutingWillEngine(config);
}

function decayScore(
  score: number,
  lastDecayAt: number,
  lastMessageAt: number,
  now: number,
  config: WillingnessConfig,
): number {
  if (![score, lastDecayAt, lastMessageAt, now].every(Number.isFinite) || now < lastDecayAt) {
    throw new TypeError("Invalid willingness decay state");
  }

  const weightedSeconds = weightedSilenceSeconds(lastDecayAt, lastMessageAt, now);
  const decayed =
    score > config.probabilityThreshold && config.probabilityThreshold > 0
      ? decayHighScore(score, weightedSeconds, config.probabilityThreshold, config.decayHalfLifeSeconds)
      : score * 0.5 ** (weightedSeconds / config.decayHalfLifeSeconds);
  return decayed < 0.01 ? 0 : Math.max(0, decayed);
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

function decayHighScore(score: number, weightedSeconds: number, threshold: number, halfLife: number): number {
  const weightedSecondsToThreshold = 2 * halfLife * Math.log2(score / threshold);
  if (weightedSeconds <= weightedSecondsToThreshold) {
    return score * 0.5 ** ((0.5 * weightedSeconds) / halfLife);
  }
  return threshold * 0.5 ** ((weightedSeconds - weightedSecondsToThreshold) / halfLife);
}

function calculateScore(current: number, data: Message["data"]): number {
  const attributes =
    (isSelfMention(data.selfId, data.elements) ? MENTION_GAIN : 0) +
    (data.channel.type === DIRECT_CHANNEL_TYPE ? DIRECT_GAIN : 0);
  const ratio = current / MAX_WILLINGNESS;
  const marginalGain = Math.max(0, 1 - ratio ** 2);
  return Math.min(
    MAX_WILLINGNESS,
    Math.max(0, current + (TEXT_GAIN + attributes) * marginalGain * dynamicGainMultiplier(ratio)),
  );
}

function calculateProbability(score: number, threshold: number): number {
  if (score <= threshold) return 0;
  return Math.min(1, Math.max(0, (score - threshold) * PROBABILITY_AMPLIFIER));
}

function dynamicGainMultiplier(ratio: number): number {
  if (ratio < 0.2) return 1;
  if (ratio < 0.8) return Math.max(1, -(((ratio - 0.5) * 2) ** 2) + 2);
  return 1 - (ratio - 0.8) / 0.2;
}

function isSelfMention(selfId: string, elements: readonly Element[] | undefined): boolean {
  return elements?.some((element) => element.type === "at" && String(element.attrs.id) === selfId) ?? false;
}
