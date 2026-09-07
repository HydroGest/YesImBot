import type { MessageLink, MessageTurn } from "./types.js";

export interface BuildLinksOptions {
  readonly selfId?: string;
  readonly maxAdjacentMs?: number;
  readonly maxEntityMs?: number;
}

export interface MessageGraph {
  readonly turns: readonly MessageTurn[];
  readonly links: readonly MessageLink[];
  readonly outEdges: ReadonlyMap<string, readonly MessageLink[]>;
  readonly componentByTurnId: ReadonlyMap<string, number>;
}

export interface ConversationChain {
  readonly id: string;
  readonly turns: readonly MessageTurn[];
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
      links.push({ from: turn.id, to: null, kind: "at", confidence: 1, evidence: [`mention:${options.selfId}`] });
    }

    if (index === 0) continue;
    const previous = turns[index - 1]!;
    const delta = turn.timestamp - previous.timestamp;
    if (delta >= 0 && delta <= (options.maxAdjacentMs ?? 60_000)) {
      links.push({ from: turn.id, to: previous.id, kind: "adjacent", confidence: 0.35, evidence: [`time-delta:${delta}ms`] });
    }
    if (delta >= 0 && delta <= (options.maxEntityMs ?? 300_000) && sharesEntity(turn, previous)) {
      links.push({ from: turn.id, to: previous.id, kind: "entity", confidence: 0.5, evidence: ["shared-bigram"] });
    }
  }

  return links;
}

export function createMessageGraph(turns: readonly MessageTurn[], links: readonly MessageLink[]): MessageGraph {
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const outEdges = new Map<string, MessageLink[]>();
  for (const link of links) {
    if (!byId.has(link.from)) continue;
    const list = outEdges.get(link.from) ?? [];
    list.push(link);
    outEdges.set(link.from, list);
  }

  const parent = new Map<string, string>(turns.map((turn) => [turn.id, turn.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current !== id) {
      parent.set(id, find(current));
    }
    return parent.get(id) ?? id;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };

  for (const link of links) {
    if (!link.to || !byId.has(link.from) || !byId.has(link.to)) continue;
    if (link.kind !== "quote" && link.kind !== "reply") continue;
    union(link.from, link.to);
  }

  const rootComponents = new Map<string, number>();
  const componentByTurnId = new Map<string, number>();
  let nextComponent = 0;
  for (const turn of turns) {
    const root = find(turn.id);
    let component = rootComponents.get(root);
    if (component === undefined) {
      component = nextComponent;
      rootComponents.set(root, component);
      nextComponent += 1;
    }
    componentByTurnId.set(turn.id, component);
  }

  return { turns, links, outEdges, componentByTurnId };
}

export function isGraphRelated(graph: MessageGraph, fromId: string, toId: string): boolean {
  const direct = graph.outEdges.get(fromId)?.some((link) => link.to === toId && link.kind !== "at" && link.confidence >= 0.5);
  if (direct) return true;
  const fromComponent = graph.componentByTurnId.get(fromId);
  const toComponent = graph.componentByTurnId.get(toId);
  return fromComponent !== undefined && fromComponent === toComponent;
}

export function buildConversationChains(
  segments: ReadonlyArray<{ readonly turns: readonly MessageTurn[] }>,
  links: readonly MessageLink[],
): ConversationChain[] {
  const turns = segments.flatMap((segment) => segment.turns);
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const parentEdges = new Map<string, MessageLink[]>();
  for (const link of links) {
    if (!link.to || !byId.has(link.from) || !byId.has(link.to)) continue;
    if (link.kind === "at" || link.confidence < 0.5) continue;
    const list = parentEdges.get(link.to) ?? [];
    list.push(link);
    parentEdges.set(link.to, list);
  }

  const chains: ConversationChain[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const chainByEnd = new Map<string, MessageTurn[]>();
    for (const turn of segment.turns) chainByEnd.set(turn.id, [turn]);

    for (const turn of segment.turns) {
      const parents = (parentEdges.get(turn.id) ?? [])
        .map((link) => byId.get(link.from))
        .filter((candidate): candidate is MessageTurn => candidate !== undefined && candidate.timestamp > turn.timestamp)
        .sort((left, right) => left.timestamp - right.timestamp);
      const parent = parents[0];
      if (!parent) continue;
      const next = [...(chainByEnd.get(turn.id) ?? [turn]), parent];
      chainByEnd.set(parent.id, next);
    }

    for (const chain of chainByEnd.values()) {
      if (chain.length < 2) continue;
      const key = chain.map((turn) => turn.id).join(">");
      if (seen.has(key)) continue;
      seen.add(key);
      const first = chain[0]!;
      const last = chain.at(-1)!;
      chains.push({ id: `chain-${first.id}-${last.id}`, turns: chain });
    }
  }

  const chainKeys = chains.map((chain) => chain.turns.map((turn) => turn.id).join(">"));
  const rootChains = chains.filter((chain, index) => {
    const key = chainKeys[index]!;
    return !chainKeys.some((other, otherIndex) => otherIndex !== index && other.length > key.length && other.startsWith(`${key}>`));
  });

  rootChains.sort((left, right) => right.turns.length - left.turns.length || (right.turns.at(-1)?.timestamp ?? 0) - (left.turns.at(-1)?.timestamp ?? 0));
  return rootChains;
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
