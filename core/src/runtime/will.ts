import type { Awaitable, Context, Element, Logger, Universal } from "koishi";

import { isMessage, type Message, type Event } from "../messages.js";
import type { ChannelScope } from "./storage.js";

const DIRECT_CHANNEL_TYPE = 1 satisfies Universal.Channel.Type;
const TEXT_GAIN = 12;
const MENTION_GAIN = 100;
const DIRECT_GAIN = 40;
const MAX_WILLINGNESS = 100;
const PROBABILITY_AMPLIFIER = 0.04;

export interface RoutingConfig {
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

export type WillConfigPatch = Partial<RoutingConfig> &
  Partial<WillingnessConfig> & { engine?: "routing" | "willingness" };

export interface WillConfigContributor {
  readonly priority?: number;
  contribute(scope: ChannelScope, config: WillConfig): Awaitable<WillConfigPatch | void>;
}

export interface WillEngineFactoryContext {
  readonly scope: ChannelScope;
  readonly config: WillConfig;
  createDefault(): WillEngine;
}

export interface WillEngineFactory {
  readonly priority?: number;
  create(context: WillEngineFactoryContext): Awaitable<WillEngine | void>;
}

export interface ResolveWillEngineOptions {
  readonly scope: ChannelScope;
  readonly contributors?: readonly WillConfigContributor[];
  readonly factories?: readonly WillEngineFactory[];
}

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

export async function resolveWillEngine(
  ctx: Context,
  config: WillConfig,
  options: ResolveWillEngineOptions,
): Promise<WillEngine> {
  const resolvedConfig = await applyWillConfigContributors(config, options.scope, options.contributors ?? []);
  const createDefault = () => createWillEngine(ctx, resolvedConfig);
  for (const factory of orderWillFactories(options.factories ?? [])) {
    const engine = await factory.create({
      scope: options.scope,
      config: resolvedConfig,
      createDefault,
    });
    if (engine) return engine;
  }
  return createDefault();
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

async function applyWillConfigContributors(
  config: WillConfig,
  scope: ChannelScope,
  contributors: readonly WillConfigContributor[],
): Promise<WillConfig> {
  let current = config;
  for (const contributor of [...contributors].sort(byPriority)) {
    const patch = await contributor.contribute(scope, current);
    if (patch) current = mergeWillConfig(current, patch);
  }
  return current;
}

function orderWillFactories(factories: readonly WillEngineFactory[]): WillEngineFactory[] {
  return [...factories].sort(byPriority);
}

function byPriority<T extends { readonly priority?: number }>(left: T, right: T): number {
  return (left.priority ?? 1000) - (right.priority ?? 1000);
}

function mergeWillConfig(config: WillConfig, patch: WillConfigPatch): WillConfig {
  const engine = patch.engine ?? config.engine;
  if (engine === "willingness") {
    const base = config.engine === "willingness" ? config : DEFAULT_WILLINGNESS_CONFIG;
    return {
      engine,
      probabilityThreshold: patch.probabilityThreshold ?? base.probabilityThreshold,
      decayHalfLifeSeconds: patch.decayHalfLifeSeconds ?? base.decayHalfLifeSeconds,
      replyCost: patch.replyCost ?? base.replyCost,
    };
  }
  const base = config.engine === "routing" ? config : DEFAULT_ROUTING_CONFIG;
  return {
    engine,
    direct: patch.direct ?? base.direct,
    mention: patch.mention ?? base.mention,
    group: patch.group ?? base.group,
  };
}

const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  direct: "trigger",
  mention: "trigger",
  group: "wait",
};

const DEFAULT_WILLINGNESS_CONFIG: WillingnessConfig = {
  probabilityThreshold: 55,
  decayHalfLifeSeconds: 600,
  replyCost: 35,
};
