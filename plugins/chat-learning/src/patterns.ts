import { generateText, type LanguageModel } from "ai";

import { patternPhrase, sanitizeForDisplay } from "./text.js";
import type {
  ConversationSegment,
  InitiationIntent,
  InitiationPattern,
  MessageTurn,
  ResponseIntent,
  ResponsePattern,
} from "./types.js";

export interface PatternSnapshot {
  readonly responsePatterns: readonly ResponsePattern[];
  readonly initiationPatterns: readonly InitiationPattern[];
}

const RESPONSE_INTENTS: readonly ResponseIntent[] = ["ack", "agree", "question", "joke", "roast", "empathy", "refuse"];
const INITIATION_INTENTS: readonly InitiationIntent[] = ["share", "question", "react", "recall", "opinion"];

export function extractPatterns(segments: readonly ConversationSegment[]): PatternSnapshot {
  const responseCounts = new Map<string, { intent: ResponseIntent; phrase: string; sampleIds: string[] }>();
  const initiationCounts = new Map<string, { intent: InitiationIntent; phrase: string; sampleIds: string[] }>();

  for (const segment of segments) {
    const turns = segment.turns;
    for (let index = 1; index < turns.length; index += 1) {
      const previous = turns[index - 1]!;
      const current = turns[index]!;
      if (current.timestamp - previous.timestamp > 120_000) continue;
      const intent = classifyResponseIntent(previous, current);
      const phrase = patternPhrase(current.text);
      if (phrase.length === 0) continue;
      const key = `${intent}:${phrase}`;
      const existing = responseCounts.get(key);
      if (existing) {
        existing.sampleIds.push(current.id);
      } else {
        responseCounts.set(key, { intent, phrase, sampleIds: [current.id] });
      }
    }

    const starter = segment.turns[0];
    if (starter && isInitiation(starter)) {
      const intent = classifyInitiationIntent(starter);
      const phrase = patternPhrase(starter.text);
      if (phrase.length > 0) {
        const key = `${intent}:${phrase}`;
        const existing = initiationCounts.get(key);
        if (existing) {
          existing.sampleIds.push(starter.id);
        } else {
          initiationCounts.set(key, { intent, phrase, sampleIds: [starter.id] });
        }
      }
    }
  }

  return {
    responsePatterns: [...responseCounts.values()]
      .map((item) => ({
        intent: item.intent,
        phrase: item.phrase,
        frequency: item.sampleIds.length,
        sampleIds: item.sampleIds.slice(0, 3),
      }))
      .sort(byFrequency),
    initiationPatterns: [...initiationCounts.values()]
      .map((item) => ({
        intent: item.intent,
        phrase: item.phrase,
        frequency: item.sampleIds.length,
        sampleIds: item.sampleIds.slice(0, 3),
      }))
      .sort(byFrequency),
  };
}

export async function classifyPatternsWithModel(
  model: LanguageModel,
  turns: readonly MessageTurn[],
  segments: readonly ConversationSegment[],
): Promise<PatternSnapshot | undefined> {
  const sampled = turns.slice(-80);
  if (sampled.length < 4) return undefined;

  const responsePairs: Array<{ previous: MessageTurn; current: MessageTurn }> = [];
  for (const segment of segments) {
    for (let index = 1; index < segment.turns.length; index += 1) {
      const previous = segment.turns[index - 1]!;
      const current = segment.turns[index]!;
      if (current.timestamp - previous.timestamp <= 120_000) {
        responsePairs.push({ previous, current });
      }
    }
  }
  const initiators = segments
    .map((segment) => segment.turns[0])
    .filter((turn): turn is MessageTurn => turn !== undefined && !turn.quoteId)
    .slice(0, 30);

  if (responsePairs.length === 0 && initiators.length === 0) return undefined;

  const conversation = [
    "## response pairs",
    ...responsePairs
      .slice(0, 40)
      .map(
        (pair, index) =>
          `[pair ${index}]\nA: ${sanitizeForDisplay(pair.previous.text)}\nB: ${sanitizeForDisplay(pair.current.text)}`,
      ),
    "## initiation messages",
    ...initiators.map((turn, index) => `[init ${index}] ${sanitizeForDisplay(turn.text)}`),
  ].join("\n");
  const system = [
    "你是一个群聊规律分析器。",
    "只能从给出的真实群聊消息中提取 exact phrase，禁止发明或改写。",
    "根据上下文为每条消息选择一个最合适的 intent。",
    "返回 JSON，不要输出其他内容。",
    '格式：{"responsePatterns":[{"intent":"agree|ack|question|joke|roast|empathy|refuse","phrase":"确实"}],"initiationPatterns":[{"intent":"share|question|react|recall|opinion","phrase":"有人试过吗"}]}',
  ].join("\n");

  try {
    const { text } = await generateText({
      model,
      system,
      prompt: conversation,
      temperature: 0.1,
    });
    const parsed = parseModelPatterns(text, sampled);
    if (parsed.responsePatterns.length === 0 && parsed.initiationPatterns.length === 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function classifyResponseIntent(previous: MessageTurn, current: MessageTurn): ResponseIntent {
  const text = current.text.trim();
  if (/^(确实|真的|对|是啊|没错|没毛病)/.test(text)) return "agree";
  if (/^(哈哈|笑死|草|hhh|hh|哈哈哈)/i.test(text)) return "joke";
  if (/^(不是|才|不可能|咋可能|离谱|这什么)/.test(text)) return "roast";
  if (/(心疼|辛苦|抱抱|太惨|可惜)/.test(text)) return "empathy";
  if (previous.text.trim().endsWith("？") || previous.text.trim().endsWith("?")) return "question";
  return "ack";
}

function classifyInitiationIntent(turn: MessageTurn): InitiationIntent {
  const text = turn.text.trim();
  if (/[？?]/.test(text) || /^(你们|有人|谁|有没有|怎么|为什么)/.test(text)) return "question";
  if (/^(看到|听说|发现|分享|最近|刚看到|刷到)/.test(text)) return "share";
  if (/^(说起来|上次|之前|还记得)/.test(text)) return "recall";
  if (/^(我觉得|我感觉|其实|说实话)/.test(text)) return "opinion";
  return "react";
}

function isInitiation(turn: MessageTurn): boolean {
  return !turn.quoteId;
}

function byFrequency(left: { readonly frequency: number }, right: { readonly frequency: number }): number {
  return right.frequency - left.frequency;
}

function parseModelPatterns(text: string, sampled: readonly MessageTurn[]): PatternSnapshot {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { responsePatterns: [], initiationPatterns: [] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { responsePatterns: [], initiationPatterns: [] };
  }

  const seenTexts = sampled.map((turn) => sanitizeForDisplay(turn.text));
  const isSeen = (phrase: string) => phrase.length > 0 && seenTexts.some((text) => text.includes(phrase));

  const responseCounts = new Map<string, { intent: ResponseIntent; phrase: string; count: number }>();
  const rawResponses = (parsed as { responsePatterns?: unknown }).responsePatterns;
  if (Array.isArray(rawResponses)) {
    for (const item of rawResponses) {
      const phrase = typeof item?.phrase === "string" ? item.phrase.trim() : "";
      if (!isSeen(phrase)) continue;
      const intent = RESPONSE_INTENTS.find((candidate) => candidate === item?.intent);
      if (!intent) continue;
      const key = `${intent}:${phrase}`;
      const existing = responseCounts.get(key);
      responseCounts.set(key, { intent, phrase, count: (existing?.count ?? 0) + 1 });
    }
  }

  const initiationCounts = new Map<string, { intent: InitiationIntent; phrase: string; count: number }>();
  const rawInitiations = (parsed as { initiationPatterns?: unknown }).initiationPatterns;
  if (Array.isArray(rawInitiations)) {
    for (const item of rawInitiations) {
      const phrase = typeof item?.phrase === "string" ? item.phrase.trim() : "";
      if (!isSeen(phrase)) continue;
      const intent = INITIATION_INTENTS.find((candidate) => candidate === item?.intent);
      if (!intent) continue;
      const key = `${intent}:${phrase}`;
      const existing = initiationCounts.get(key);
      initiationCounts.set(key, { intent, phrase, count: (existing?.count ?? 0) + 1 });
    }
  }

  return {
    responsePatterns: [...responseCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.count, sampleIds: [] }))
      .sort(byFrequency),
    initiationPatterns: [...initiationCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.count, sampleIds: [] }))
      .sort(byFrequency),
  };
}
