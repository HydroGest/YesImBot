import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { GlobalPattern, GlobalPatternKind, GlobalRuleBank, InitiationPattern, ResponsePattern } from "./types.js";

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
          bank = content.trim().length > 0 ? (JSON.parse(content) as GlobalRuleBank) : createEmptyGlobalRuleBank();
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
  return {
    version: 1,
    updatedAt: Date.now(),
    patterns: [],
  };
}

export function mergeLocalPatterns(
  bank: GlobalRuleBank,
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
  scopeKey: string,
  now: number,
): GlobalRuleBank {
  const byKey = new Map(bank.patterns.map((pattern) => [patternKey(pattern), cloneGlobalPattern(pattern)]));
  const channelKey = channelFingerprint(scopeKey);

  for (const pattern of responsePatterns) {
    mergePattern(byKey, "response", pattern.intent, pattern.phrase, pattern.frequency, channelKey, now);
  }
  for (const pattern of initiationPatterns) {
    mergePattern(byKey, "initiation", pattern.intent, pattern.phrase, pattern.frequency, channelKey, now);
  }

  return {
    version: bank.version,
    updatedAt: now,
    patterns: [...byKey.values()].sort(byScore),
  };
}

export function selectGlobalPatterns(
  bank: GlobalRuleBank,
  kind: GlobalPatternKind,
  minChannels: number,
  max: number,
): readonly GlobalPattern[] {
  return bank.patterns
    .filter((pattern) => pattern.kind === kind && pattern.channels.length >= minChannels)
    .sort(byScore)
    .slice(0, max);
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
    byKey.set(key, {
      kind,
      intent,
      phrase,
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
  byKey.set(key, { ...existing, channels, lastSeenAt: now });
}

function cloneGlobalPattern(pattern: GlobalPattern): GlobalPattern {
  return {
    ...pattern,
    channels: pattern.channels.map((channel) => ({ ...channel })),
  };
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

function channelFingerprint(scopeKey: string): string {
  return createHash("sha256").update(scopeKey).digest("hex").slice(0, 16);
}
