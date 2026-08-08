export type Decision = "wait" | "trigger";

export interface PolicyRoutingConfig {
  readonly direct: Decision;
  readonly mention: Decision;
  readonly mentionAll: Decision;
  readonly mentionHere: Decision;
  readonly quote: Decision;
  readonly image: Decision;
  readonly poke: Decision;
  readonly group: Decision;
}

export interface PolicyWillingnessConfig {
  readonly maxScore: number;
  readonly initialScore: number;
  readonly decayHalfLifeSeconds: number;
  readonly probabilityThreshold: number;
  readonly probabilityAmplifier: number;
  readonly replyCost: number;
  readonly textGain: number;
  readonly mentionGain: number;
  readonly quoteGain: number;
  readonly directGain: number;
  readonly imageGain: number;
  readonly pokeGain: number;
  readonly keywords: string[];
  readonly keywordMultiplier: number;
  readonly defaultMultiplier: number;
  readonly hotWindowSeconds: number;
  readonly warmWindowSeconds: number;
  readonly hotDecayWeight: number;
  readonly warmDecayWeight: number;
  readonly mentionForce: boolean;
  readonly quoteForce: boolean;
  readonly directForce: boolean;
}

export interface WillPolicyConfig {
  readonly engine: "routing" | "willingness";
  readonly routing: PolicyRoutingConfig;
  readonly willingness: PolicyWillingnessConfig;
  readonly factoryPriority?: number;
}

export function defaultRoutingConfig(): PolicyRoutingConfig {
  return { direct: "trigger", mention: "trigger", mentionAll: "wait", mentionHere: "wait", quote: "wait", image: "wait", poke: "wait", group: "wait" };
}

export function defaultWillingnessConfig(): PolicyWillingnessConfig {
  return {
    maxScore: 100,
    initialScore: 0,
    decayHalfLifeSeconds: 600,
    probabilityThreshold: 55,
    probabilityAmplifier: 0.04,
    replyCost: 35,
    textGain: 12,
    mentionGain: 100,
    quoteGain: 15,
    directGain: 40,
    imageGain: 8,
    pokeGain: 80,
    keywords: [],
    keywordMultiplier: 1.2,
    defaultMultiplier: 1,
    hotWindowSeconds: 15,
    warmWindowSeconds: 60,
    hotDecayWeight: 0.3,
    warmDecayWeight: 0.7,
    mentionForce: false,
    quoteForce: false,
    directForce: false,
  };
}
