import type { MessageLink, MessageTurn } from "./types.js";

export interface BuildLinksOptions {
  readonly selfId?: string;
  readonly maxAdjacentMs?: number;
  readonly maxEntityMs?: number;
}

export function buildLinks(turns: readonly MessageTurn[], options: BuildLinksOptions = {}): MessageLink[] {
  const links: MessageLink[] = [];
  const byMessageId = new Map<string, MessageTurn>();
  const byTurnId = new Map<string, MessageTurn>();
  for (const turn of turns) {
    byMessageId.set(turn.messageId, turn);
    byTurnId.set(turn.id, turn);
  }

  for (const [index, turn] of turns.entries()) {
    if (turn.quoteId) {
      const target = byMessageId.get(turn.quoteId) ?? byTurnId.get(turn.quoteId);
      if (target && target.id !== turn.id) {
        links.push({
          from: turn.id,
          to: target.id,
          kind: turn.quoteType === "quote" ? "quote" : "reply",
          confidence: 1,
          evidence: [`platform:${turn.quoteType ?? "reply"}`, `target:${target.messageId}`],
        });
      }
    }

    if (options.selfId && turn.mentionIds.includes(options.selfId)) {
      links.push({
        from: turn.id,
        to: null,
        kind: "at",
        confidence: 1,
        evidence: [`mention:${options.selfId}`],
      });
    }

    if (index === 0) continue;
    const previous = turns[index - 1]!;
    const delta = turn.timestamp - previous.timestamp;
    if (delta >= 0 && delta <= (options.maxAdjacentMs ?? 60_000)) {
      links.push({
        from: turn.id,
        to: previous.id,
        kind: "adjacent",
        confidence: 0.35,
        evidence: [`time-delta:${delta}ms`],
      });
    }
    if (delta >= 0 && delta <= (options.maxEntityMs ?? 300_000) && sharesEntity(turn, previous)) {
      links.push({
        from: turn.id,
        to: previous.id,
        kind: "entity",
        confidence: 0.5,
        evidence: ["shared-bigram"],
      });
    }
  }

  return links;
}

function sharesEntity(left: MessageTurn, right: MessageTurn): boolean {
  const leftBigrams = bigrams(left.text);
  if (leftBigrams.size === 0) return false;
  for (const bigram of bigrams(right.text)) {
    if (leftBigrams.has(bigram)) return true;
  }
  return false;
}

function bigrams(text: string): Set<string> {
  const cleaned = text.replace(/[\s\p{P}\p{S}]/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < cleaned.length - 1; index += 1) {
    result.add(cleaned.slice(index, index + 2));
  }
  return result;
}
