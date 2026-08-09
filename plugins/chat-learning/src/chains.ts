import { buildConversationChains } from "./links.js";
import { sanitizeForDisplay } from "./text.js";
import type { ConversationSegment, InitiationPattern, LocalChainSample, LocalChainPattern, MessageLink, MessageTurn, ResponsePattern } from "./types.js";

export function buildLocalChainPatterns(
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[],
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
): LocalChainPattern[] {
  const intentByTurnId = buildIntentByTurnId(responsePatterns, initiationPatterns);
  const counts = new Map<string, { chain: string[]; frequency: number; sample: LocalChainSample | undefined }>();
  for (const chain of buildConversationChains(segments, links)) {
    if (chain.turns.length < 2) continue;
    const intents = chain.turns.map((turn) => intentByTurnId.get(turn.id));
    if (intents.some((intent) => intent === undefined)) continue;
    const key = intents.join(">");
    const existing = counts.get(key) ?? { chain: intents as string[], frequency: 0, sample: undefined };
    existing.frequency += 1;
    if (!existing.sample) existing.sample = createChainSample(chain.turns, intentByTurnId);
    counts.set(key, existing);
  }

  return [...counts.values()].map(({ chain, frequency, sample }) => ({ chain, frequency, sample })).sort((left, right) => right.frequency - left.frequency);
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

function createChainSample(turns: readonly MessageTurn[], intentByTurnId: ReadonlyMap<string, string>): LocalChainSample | undefined {
  const speakers = new Map<string, string>();
  let nextSpeaker = 0;
  const sampleTurns = turns
    .slice(-5)
    .map((turn) => {
      const text = sanitizeForDisplay(turn.text).trim().slice(0, 80);
      const speaker = speakers.get(turn.userId) ?? String.fromCharCode(65 + nextSpeaker++);
      speakers.set(turn.userId, speaker);
      return { intent: intentByTurnId.get(turn.id) ?? "", speaker, text: text.length > 0 ? text : turn.hasImage ? "[图片]" : "" };
    })
    .filter((turn) => turn.intent.length > 0 && turn.text.length > 0);
  return sampleTurns.length >= 2 ? { turns: sampleTurns } : undefined;
}
