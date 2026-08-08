import { generateText, type LanguageModel } from "ai";

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
      const phrase = extractPhrase(current.text);
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
      const phrase = extractPhrase(starter.text);
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

export async function enrichPatternsWithModel(
  model: LanguageModel,
  turns: readonly MessageTurn[],
  base: PatternSnapshot,
): Promise<PatternSnapshot> {
  const sampled = turns.slice(-60);
  if (sampled.length < 6) return base;

  const conversation = sampled
    .map((turn, index) => `[${index}] ${turn.userName ?? turn.userId}: ${turn.text}`)
    .join("\n");
  const system = [
    "你是一个群聊规律分析器。",
    "只能从给出的真实群聊消息中提取 exact phrase，禁止发明或改写。",
    "返回 JSON，不要输出其他内容。",
    '格式：{"responsePatterns":[{"intent":"agree|ack|question|joke|roast|empathy|refuse","phrase":"确实"}],"initiationPatterns":[{"intent":"share|question|react|recall|opinion","phrase":"你们看到"} ]}',
  ].join("\n");

  try {
    const { text } = await generateText({
      model,
      system,
      prompt: conversation,
      temperature: 0.1,
    });
    const parsed = parseModelPatterns(text, sampled);
    return {
      responsePatterns: mergePatterns(base.responsePatterns, parsed.responsePatterns),
      initiationPatterns: mergePatterns(base.initiationPatterns, parsed.initiationPatterns),
    };
  } catch {
    return base;
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

function extractPhrase(text: string): string {
  const cleaned = text
    .trim()
    .replace(/[。！!？?，,～~]+$/g, "")
    .trim();
  if (cleaned.length === 0) return "";
  if (cleaned.length <= 12) return cleaned;
  const firstClause = cleaned.split(/[，,。！!？?；;：:\n]/)[0]?.trim() ?? "";
  if (firstClause.length >= 2 && firstClause.length <= 12) return firstClause;
  return cleaned.slice(0, 12);
}

function byFrequency(left: { readonly frequency: number }, right: { readonly frequency: number }): number {
  return right.frequency - left.frequency;
}

function parseModelPatterns(
  text: string,
  sampled: readonly MessageTurn[],
): { responsePatterns: readonly ResponsePattern[]; initiationPatterns: readonly InitiationPattern[] } {
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

  const seenTexts = sampled.map((turn) => turn.text);
  const isSeen = (phrase: string) => phrase.length > 0 && seenTexts.some((text) => text.includes(phrase));

  const responsePatterns: ResponsePattern[] = [];
  const rawResponses = (parsed as { responsePatterns?: unknown }).responsePatterns;
  if (Array.isArray(rawResponses)) {
    for (const item of rawResponses) {
      const phrase = typeof item?.phrase === "string" ? item.phrase.trim() : "";
      if (!isSeen(phrase)) continue;
      const intent = RESPONSE_INTENTS.find((candidate) => candidate === item?.intent);
      if (!intent) continue;
      responsePatterns.push({ intent, phrase, frequency: 1, sampleIds: [] });
    }
  }

  const initiationPatterns: InitiationPattern[] = [];
  const rawInitiations = (parsed as { initiationPatterns?: unknown }).initiationPatterns;
  if (Array.isArray(rawInitiations)) {
    for (const item of rawInitiations) {
      const phrase = typeof item?.phrase === "string" ? item.phrase.trim() : "";
      if (!isSeen(phrase)) continue;
      const intent = INITIATION_INTENTS.find((candidate) => candidate === item?.intent);
      if (!intent) continue;
      initiationPatterns.push({ intent, phrase, frequency: 1, sampleIds: [] });
    }
  }

  return { responsePatterns, initiationPatterns };
}

function mergePatterns<T extends { readonly intent: string; readonly phrase: string }>(
  base: readonly T[],
  model: readonly T[],
): readonly T[] {
  const byKey = new Map<string, T & { frequency: number }>();
  for (const item of base) {
    const key = `${item.intent}:${item.phrase}`;
    byKey.set(key, { ...item, frequency: "frequency" in item ? Number(item.frequency) : 1 });
  }
  for (const item of model) {
    const key = `${item.intent}:${item.phrase}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...item,
      frequency: (existing?.frequency ?? 0) + ("frequency" in item ? Number(item.frequency) : 1),
    });
  }
  return [...byKey.values()].sort((left, right) => right.frequency - left.frequency);
}
