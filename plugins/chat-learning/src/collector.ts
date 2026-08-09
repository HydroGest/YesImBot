import type { AgentEntry } from "@yesimbot/agent-runtime";
import type { Element } from "koishi";
import { isMessage } from "koishi-plugin-yesimbot";

import type { ConversationSegment, MessageTurn } from "./types.js";

export interface CollectOptions {
  readonly maxHistoryAgeDays?: number;
  readonly maxScanMessages?: number;
  readonly now?: number;
  readonly blockedUserIds?: readonly string[];
  readonly blockedUserPatterns?: readonly string[];
  readonly autoBlockBotNames?: boolean;
}

export function collectTurns(entries: readonly AgentEntry[], options: CollectOptions = {}): MessageTurn[] {
  const now = options.now ?? Date.now();
  const maxAgeMs = (options.maxHistoryAgeDays ?? 30) * 24 * 60 * 60 * 1000;
  const maxScanMessages = options.maxScanMessages ?? 1000;
  const cutoff = now - maxAgeMs;
  const blockedIds = new Set(options.blockedUserIds ?? []);
  const blockedPatterns = [...(options.blockedUserPatterns ?? []), ...(options.autoBlockBotNames ? DEFAULT_BOT_PATTERNS : [])];
  const turns: MessageTurn[] = [];

  for (const entry of entries) {
    if (entry.type !== "message" || entry.timestamp < cutoff) continue;
    const message = entry.data;
    if (!isMessage(message)) continue;
    const data = message.data;
    if (blockedIds.has(data.user.id)) continue;
    if (matchesBlockedPattern(data.user.id, data.user.name, blockedPatterns)) continue;
    const text = renderElements(data.elements).trim();
    if (text.length === 0) continue;
    turns.push({
      id: entry.id,
      messageId: data.messageId,
      userId: data.user.id,
      userName: data.user.name,
      timestamp: entry.timestamp,
      text,
      elementKinds: data.elements.map((element) => element.type),
      hasImage: data.elements.some((element) => element.type === "img" || element.type === "image"),
      quoteId: findQuoteId(data.elements),
      quoteType: findQuoteType(data.elements),
      mentionIds: findMentionIds(data.elements),
    });
  }

  return turns.sort((left, right) => left.timestamp - right.timestamp).slice(-maxScanMessages);
}

const DEFAULT_BOT_PATTERNS = ["bot", "机器人", "小助手", "官方", "客服", "通知", "公告"];

function matchesBlockedPattern(userId: string, userName: string | undefined, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const haystack = `${userId} ${userName ?? ""}`.toLowerCase();
  return patterns.some((pattern) => pattern.length > 0 && haystack.includes(pattern.toLowerCase()));
}

export function segmentTurns(turns: readonly MessageTurn[], maxGapMs = 10 * 60 * 1000): ConversationSegment[] {
  const segments: ConversationSegment[] = [];
  let current: MessageTurn[] = [];
  let startTime = 0;
  let previous: MessageTurn | undefined;

  for (const turn of turns) {
    if (current.length > 0 && previous && turn.timestamp - previous.timestamp > maxGapMs) {
      segments.push(createSegment(segments.length, current, startTime));
      current = [];
    }
    if (current.length === 0) startTime = turn.timestamp;
    current.push(turn);
    previous = turn;
  }

  if (current.length > 0) segments.push(createSegment(segments.length, current, startTime));
  return segments;
}

function createSegment(index: number, turns: readonly MessageTurn[], startTime: number): ConversationSegment {
  return { id: `segment-${index}`, startTime, endTime: turns.at(-1)?.timestamp ?? startTime, turns };
}

function renderElements(elements: readonly Element[]): string {
  return elements.map(renderElement).join("");
}

function renderElement(element: Element): string {
  if (element.type === "text") return String(element.attrs.content ?? "");
  if (element.type === "img" || element.type === "image") return "[图片]";
  if (element.type === "at") {
    const name = element.attrs.name;
    const id = element.attrs.id;
    if (typeof name === "string" && name.length > 0) return `@${name}`;
    if (typeof id === "string" && id.length > 0) return `@${id}`;
    return "@";
  }
  if (element.type === "quote" || element.type === "reply") {
    const children = renderElements(element.children);
    return children.trim().length > 0 ? `[引用:${children}]` : "[引用]";
  }
  return renderElements(element.children);
}

function findQuoteId(elements: readonly Element[]): string | undefined {
  for (const element of elements) {
    if (element.type === "quote" || element.type === "reply") {
      const id = element.attrs.id;
      if (typeof id === "string" && id.length > 0) return id;
    }
    const nested = findQuoteId(element.children);
    if (nested) return nested;
  }
  return undefined;
}

function findQuoteType(elements: readonly Element[]): MessageTurn["quoteType"] {
  for (const element of elements) {
    if (element.type === "quote" || element.type === "reply") return element.type;
    const nested = findQuoteType(element.children);
    if (nested) return nested;
  }
  return undefined;
}

function findMentionIds(elements: readonly Element[]): string[] {
  const ids: string[] = [];
  for (const element of elements) {
    if (element.type === "at") {
      const id = element.attrs.id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
    ids.push(...findMentionIds(element.children));
  }
  return ids;
}
