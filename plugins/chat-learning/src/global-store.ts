import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { cosineSimilarity } from "./embedding.js";
import type {
  GlobalChainSample,
  GlobalChainPattern,
  GlobalPattern,
  GlobalPatternKind,
  GlobalRuleBank,
  InitiationPattern,
  LocalChainSample,
  LocalChainPattern,
  MemeTemplate,
  ResponsePattern,
} from "./types.js";

export interface GlobalRuleStore {
  init(): Promise<void>;
  read(): GlobalRuleBank;
  update(next: GlobalRuleBank): Promise<void>;
}

export function createGlobalRuleStore(filePath: string): GlobalRuleStore {
  let bank: GlobalRuleBank = createEmptyGlobalRuleBank();
  let tail: Promise<void> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    async init() {
      await serialize(async () => {
        try {
          const content = await readFile(filePath, "utf8");
          bank = content.trim().length > 0 ? normalizeGlobalRuleBank(JSON.parse(content)) : createEmptyGlobalRuleBank();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") bank = createEmptyGlobalRuleBank();
        }
      });
    },
    read() {
      return bank;
    },
    update(next) {
      return serialize(async () => {
        bank = next;
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        try {
          await rename(temporary, filePath);
        } finally {
          await rm(temporary, { force: true });
        }
      });
    },
  };
}

export function createEmptyGlobalRuleBank(): GlobalRuleBank {
  return { version: 1, updatedAt: Date.now(), patterns: [], chains: [], templates: [] };
}

export function mergeLocalPatterns(
  bank: GlobalRuleBank,
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
  chainPatterns: readonly LocalChainPattern[],
  scopeKey: string,
  now: number,
  options: { localEmbeddings?: ReadonlyMap<string, readonly number[]>; embeddingSimilarity?: number } = {},
): GlobalRuleBank {
  const byKey = new Map(bank.patterns.map((pattern) => [patternKey(pattern), cloneGlobalPattern(pattern)]));
  const byChainKey = new Map(bank.chains.map((chain) => [chainKey(chain.chain), cloneGlobalChain(chain)]));
  const channelKey = channelFingerprint(scopeKey);

  for (const pattern of responsePatterns) {
    mergePatternWithEmbedding(
      byKey,
      "response",
      pattern.intent,
      pattern.phrase,
      pattern.frequency,
      channelKey,
      now,
      options.localEmbeddings?.get(`response:${pattern.intent}:${pattern.phrase}`),
      options.embeddingSimilarity,
    );
  }
  for (const pattern of initiationPatterns) {
    mergePatternWithEmbedding(
      byKey,
      "initiation",
      pattern.intent,
      pattern.phrase,
      pattern.frequency,
      channelKey,
      now,
      options.localEmbeddings?.get(`initiation:${pattern.intent}:${pattern.phrase}`),
      options.embeddingSimilarity,
    );
  }
  for (const chain of chainPatterns) {
    mergeChainPattern(
      byChainKey,
      chain.chain,
      chain.frequency,
      channelKey,
      now,
      chain.sample,
      chain.style,
      chain.styleSampleId,
      chain.semantics,
    );
  }

  return {
    version: bank.version,
    updatedAt: now,
    patterns: [...byKey.values()].sort(byScore),
    chains: [...byChainKey.values()].sort(byChainScore),
    templates: bank.templates ?? [],
  };
}

export function selectGlobalPatterns(bank: GlobalRuleBank, kind: GlobalPatternKind, minChannels: number, max: number): readonly GlobalPattern[] {
  return bank.patterns
    .filter((pattern) => pattern.kind === kind && pattern.channels.length >= minChannels)
    .sort(byScore)
    .slice(0, max);
}

export function selectGlobalChains(bank: GlobalRuleBank, minChannels: number, max: number): readonly GlobalChainPattern[] {
  return bank.chains
    .filter((chain) => chain.channels.length >= minChannels)
    .sort(byChainScore)
    .slice(0, max);
}

export function selectGlobalMemeTemplates(bank: GlobalRuleBank, max: number): readonly MemeTemplate[] {
  return (bank.templates ?? []).slice(0, max);
}

export function selectRelevantGlobalChains(bank: GlobalRuleBank, currentText: string, minChannels: number, max: number): readonly GlobalChainPattern[] {
  const query = normalizeRelevanceText(currentText);
  if (query.length === 0) return [];
  return bank.chains
    .filter((chain) => chain.channels.length >= minChannels)
    .map((chain) => ({ chain, score: chainRelevanceScore(chain, query) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || chainScore(right.chain) - chainScore(left.chain))
    .slice(0, max)
    .map((candidate) => candidate.chain);
}

function mergePattern(
  byKey: Map<string, GlobalPattern>,
  kind: GlobalPatternKind,
  intent: string,
  phrase: string,
  frequency: number,
  channelKey: string,
  now: number,
): void {
  const key = `${kind}:${intent}:${phrase}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, { kind, intent, phrase, channels: [{ key: channelKey, frequency, lastSeenAt: now }], firstSeenAt: now, lastSeenAt: now });
    return;
  }

  const channelIndex = existing.channels.findIndex((channel) => channel.key === channelKey);
  const channels = [...existing.channels];
  if (channelIndex >= 0) {
    channels[channelIndex] = { ...channels[channelIndex]!, frequency, lastSeenAt: now };
  } else {
    channels.push({ key: channelKey, frequency, lastSeenAt: now });
  }
  byKey.set(key, { ...existing, channels, lastSeenAt: now });
}

function mergePatternWithEmbedding(
  byKey: Map<string, GlobalPattern>,
  kind: GlobalPatternKind,
  intent: string,
  phrase: string,
  frequency: number,
  channelKey: string,
  now: number,
  embedding: readonly number[] | undefined,
  embeddingSimilarity: number | undefined,
): void {
  const exact = byKey.get(`${kind}:${intent}:${phrase}`);
  const target = exact ?? findSimilarPattern(byKey, kind, intent, embedding, embeddingSimilarity);
  if (target) {
    const updated = embedding && !target.embedding ? { ...target, embedding: [...embedding] } : target;
    byKey.set(patternKey(updated), updated);
    mergePattern(byKey, updated.kind, updated.intent, updated.phrase, frequency, channelKey, now);
    return;
  }

  const key = `${kind}:${intent}:${phrase}`;
  byKey.set(key, {
    kind,
    intent,
    phrase,
    channels: [{ key: channelKey, frequency, lastSeenAt: now }],
    firstSeenAt: now,
    lastSeenAt: now,
    ...(embedding ? { embedding: [...embedding] } : {}),
  });
}

function findSimilarPattern(
  byKey: Map<string, GlobalPattern>,
  kind: GlobalPatternKind,
  intent: string,
  embedding: readonly number[] | undefined,
  embeddingSimilarity: number | undefined,
): GlobalPattern | undefined {
  if (!embedding || !embeddingSimilarity || embeddingSimilarity >= 1) return undefined;
  for (const pattern of byKey.values()) {
    if (pattern.kind !== kind || pattern.intent !== intent || !pattern.embedding) continue;
    if (cosineSimilarity(embedding, pattern.embedding) >= embeddingSimilarity) return pattern;
  }
  return undefined;
}

function cloneGlobalPattern(pattern: GlobalPattern): GlobalPattern {
  return { ...pattern, channels: pattern.channels.map((channel) => ({ ...channel })), ...(pattern.embedding ? { embedding: [...pattern.embedding] } : {}) };
}

function mergeChainPattern(
  byKey: Map<string, GlobalChainPattern>,
  chain: readonly string[],
  frequency: number,
  channelKey: string,
  now: number,
  sample: LocalChainSample | undefined,
  style: string | undefined,
  styleSampleId: string | undefined,
  semantics: string | undefined,
): void {
  const key = chainKey(chain);
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, {
      chain: [...chain],
      samples: sample ? [{ ...sample, channelKey }] : [],
      style,
      styleSampleId,
      semantics,
      channels: [{ key: channelKey, frequency, lastSeenAt: now }],
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return;
  }

  const channelIndex = existing.channels.findIndex((channel) => channel.key === channelKey);
  const channels = [...existing.channels];
  if (channelIndex >= 0) {
    channels[channelIndex] = { ...channels[channelIndex]!, frequency, lastSeenAt: now };
  } else {
    channels.push({ key: channelKey, frequency, lastSeenAt: now });
  }
  const samples = existing.samples ? existing.samples.map((item) => ({ ...item })) : [];
  if (sample && !samples.some((item) => sameSample(item, sample))) {
    samples.push({ ...sample, channelKey });
  }
  const styleChanged = style !== undefined && styleSampleId !== undefined && existing.styleSampleId !== styleSampleId;
  const nextStyle = styleChanged ? style : existing.style ?? style;
  const nextStyleSampleId = styleChanged ? styleSampleId : existing.styleSampleId ?? styleSampleId;
  byKey.set(key, {
    ...existing,
    style: nextStyle,
    styleSampleId: nextStyleSampleId,
    semantics: existing.semantics ?? semantics,
    samples: samples.slice(-2),
    channels,
    lastSeenAt: now,
  });
}

function cloneGlobalChain(chain: GlobalChainPattern): GlobalChainPattern {
  return {
    ...chain,
    chain: [...chain.chain],
    style: chain.style,
    styleSampleId: chain.styleSampleId,
    semantics: chain.semantics,
    samples: chain.samples?.map((sample) => ({ ...sample, turns: sample.turns.map((turn) => ({ ...turn })) })),
    channels: chain.channels.map((channel) => ({ ...channel })),
  };
}

function sameSample(left: GlobalChainSample, right: LocalChainSample): boolean {
  if (left.turns.length !== right.turns.length) return false;
  return left.turns.every((turn, index) => turn.text === right.turns[index]?.text && turn.speaker === right.turns[index]?.speaker);
}

function chainRelevanceScore(chain: GlobalChainPattern, query: string): number {
  let best = 0;
  for (const sample of chain.samples ?? []) {
    for (const turn of sample.turns) {
      const candidate = normalizeRelevanceText(turn.text);
      if (candidate.length === 0) continue;
      best = Math.max(best, textSimilarity(query, candidate));
    }
  }
  return best;
}

function normalizeRelevanceText(value: string): string {
  return value
    .replace(/\[time=[^\]]*\]/g, " ")
    .replace(/data:[^"'\s>]+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/asset:\/\/[a-f0-9]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@\S+/g, "@")
    .replace(/[\s\p{P}\p{S}\p{C}]+/gu, "")
    .toLowerCase();
}

function textSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  if (left.includes(right) || right.includes(left)) return 0.6;
  const leftChars = new Set(left);
  const rightChars = new Set(right);
  let intersection = 0;
  for (const char of leftChars) {
    if (rightChars.has(char)) intersection += 1;
  }
  const union = leftChars.size + rightChars.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function patternKey(pattern: GlobalPattern): string {
  return `${pattern.kind}:${pattern.intent}:${pattern.phrase}`;
}

function byScore(left: GlobalPattern, right: GlobalPattern): number {
  return patternScore(right) - patternScore(left);
}

function patternScore(pattern: GlobalPattern): number {
  return pattern.channels.reduce((total, channel) => total + channel.frequency, 0) * pattern.channels.length;
}

function chainKey(chain: readonly string[]): string {
  return chain.join(">");
}

function byChainScore(left: GlobalChainPattern, right: GlobalChainPattern): number {
  return chainScore(right) - chainScore(left);
}

function chainScore(chain: GlobalChainPattern): number {
  return chain.channels.reduce((total, channel) => total + channel.frequency, 0) * chain.channels.length;
}

function channelFingerprint(scopeKey: string): string {
  return createHash("sha256").update(scopeKey).digest("hex").slice(0, 16);
}

function normalizeGlobalRuleBank(value: unknown): GlobalRuleBank {
  const parsed = (typeof value === "object" && value !== null ? value : {}) as Partial<GlobalRuleBank>;
  return {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
    chains: Array.isArray(parsed.chains) ? parsed.chains : [],
    templates: Array.isArray(parsed.templates) ? parsed.templates : [],
  };
}
