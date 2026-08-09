import { buildConversationChains } from "./links.js";
import type { ConversationSegment, InitiationPattern, LocalChainPattern, MessageLink, ResponsePattern } from "./types.js";

export function buildLocalChainPatterns(
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[],
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
): LocalChainPattern[] {
  const intentByTurnId = buildIntentByTurnId(responsePatterns, initiationPatterns);
  const counts = new Map<string, { chain: string[]; frequency: number }>();
  for (const chain of buildConversationChains(segments, links)) {
    if (chain.turns.length < 2) continue;
    const intents = chain.turns.map((turn) => intentByTurnId.get(turn.id));
    if (intents.some((intent) => intent === undefined)) continue;
    const key = intents.join(">");
    const existing = counts.get(key) ?? { chain: intents as string[], frequency: 0 };
    existing.frequency += 1;
    counts.set(key, existing);
  }

  return [...counts.values()].sort((left, right) => right.frequency - left.frequency);
}

export function buildIntentByTurnId(responsePatterns: readonly ResponsePattern[], initiationPatterns: readonly InitiationPattern[]): Map<string, string> {
  const intentByTurnId = new Map<string, string>();
  for (const pattern of responsePatterns) {
    for (const sampleId of pattern.sampleIds) intentByTurnId.set(sampleId, pattern.intent);
  }
  for (const pattern of initiationPatterns) {
    for (const sampleId of pattern.sampleIds) intentByTurnId.set(sampleId, pattern.intent);
  }
  return intentByTurnId;
}
