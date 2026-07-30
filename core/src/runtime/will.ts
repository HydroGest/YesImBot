import type { Awaitable, Element, Universal } from "koishi";

import type { Config } from "../config.js";
import { isMessage, type Input, type Message } from "../input.js";

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

export interface WillEngine {
  decide(input: Input, state: WillEngine.State): Awaitable<WillEngine.Decision>;
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
  readonly event: Input;
  readonly decision: WillEngine.Decision;
}

export interface WillEngineDiagnostics {
  readonly now: () => number;
  readonly random: () => number;
  readonly warn: (event: string, fields: Record<string, unknown>) => void;
}

export interface WillingnessConfig {
  readonly probabilityThreshold: number;
  readonly decayHalfLifeSeconds: number;
  readonly replyCost: number;
}

export interface WillingnessWillOptions {
  readonly config: WillingnessConfig;
  readonly now: () => number;
  readonly random: () => number;
  readonly warn: (event: string, fields: Record<string, unknown>) => void;
}

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  direct: "trigger",
  mention: "trigger",
  group: "wait",
};

function resolveWillingnessConfig(
  config: Extract<Config["will"], { readonly engine: "willingness" }>,
): WillingnessConfig {
  return {
    probabilityThreshold: config.probabilityThreshold ?? 55,
    decayHalfLifeSeconds: config.decayHalfLifeSeconds ?? 600,
    replyCost: config.replyCost ?? 35,
  };
}

export function createWillEngine(
  config: Config["will"] | undefined,
  diagnostics: WillEngineDiagnostics,
): WillEngine {
  if (config?.engine === "willingness") {
    return new WillingnessWillEngine({ config: resolveWillingnessConfig(config), ...diagnostics });
  }
  return new RoutingWillEngine(config);
}

export class RoutingWillEngine implements WillEngine {
  private readonly config: RoutingConfig;

  constructor(config: Partial<RoutingConfig> = {}) {
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config };
  }

  async decide(input: Input, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";
    if (input.data.channel.type === DIRECT_CHANNEL_TYPE) return this.config.direct;
    if (isSelfMention(input.data.selfId, input.data.elements)) return this.config.mention;
    return this.config.group;
  }
}

export class WillingnessWillEngine implements WillEngine {
  private score = 0;
  private lastMessageAt: number | null = null;
  private lastDecayAt: number | null = null;

  constructor(private readonly options: WillingnessWillOptions) {
    assertValidConfig(options.config);
  }

  async decide(input: Input, _state: WillEngine.State): Promise<WillEngine.Decision> {
    if (!isMessage(input)) return "wait";

    try {
      const now = this.options.now();
      const decayedScore =
        this.lastDecayAt === null || this.lastMessageAt === null
          ? this.score
          : decayScore(this.score, this.lastDecayAt, this.lastMessageAt, now, this.options.config);
      const nextScore = calculateScore(decayedScore, input.data);
      const probability = calculateProbability(nextScore, this.options.config.probabilityThreshold);
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
    this.score = Math.max(0, this.score - this.options.config.replyCost);
  }

  private warn(cause: unknown): void {
    try {
      this.options.warn("will.willingness.calculation_failed", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    } catch {}
  }
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
      ? decayHighScore(
          score,
          weightedSeconds,
          config.probabilityThreshold,
          config.decayHalfLifeSeconds,
        )
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
  return (
    elements?.some((element) => element.type === "at" && String(element.attrs.id) === selfId) ??
    false
  );
}

function assertValidConfig(config: WillingnessConfig): void {
  const { probabilityThreshold, decayHalfLifeSeconds, replyCost } = config;
  if (
    ![probabilityThreshold, decayHalfLifeSeconds, replyCost].every(Number.isFinite) ||
    probabilityThreshold < 0 ||
    decayHalfLifeSeconds <= 0 ||
    replyCost < 0
  ) {
    throw new TypeError("Invalid willingness configuration");
  }
}

declare module "koishi" {
  interface Events {
    "yesimbot/will": (observation: WillEngineObservation) => void;
  }
}
