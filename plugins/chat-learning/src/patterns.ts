import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

import { buildConversationChains } from "./links.js";
import { patternPhrase, sanitizeForDisplay } from "./text.js";
import type {
  ConversationSegment,
  InitiationIntent,
  InitiationPattern,
  LocalChainSample,
  MessageLink,
  MessageTurn,
  ResponseIntent,
  ResponsePattern,
} from "./types.js";

const RESPONSE_INTENTS = ["ack", "agree", "question", "joke", "roast", "empathy", "refuse"] as const;

const INITIATION_INTENTS = ["share", "question", "react", "recall", "opinion"] as const;

const messageAnnotationSchema = z.object({ id: z.string(), role: z.enum(["response", "initiation", "noise"]), intent: z.string() });

const modelOutputSchema = z.object({ messages: z.array(messageAnnotationSchema).optional() });

const MAX_MODEL_MESSAGES = 80;

const MAX_MODEL_CHARS = 12_000;

export interface PatternSnapshot {
  readonly responsePatterns: readonly ResponsePattern[];
  readonly initiationPatterns: readonly InitiationPattern[];
}

export interface ClassifyModelOptions {
  readonly maxThreads?: number;
  readonly maxThreadMessages?: number;
}

interface ClassifyThread {
  readonly turns: readonly MessageTurn[];
}

export async function classifyPatternsWithModel(
  model: LanguageModel,
  turns: readonly MessageTurn[],
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[] = [],
  options: ClassifyModelOptions = {},
): Promise<PatternSnapshot | undefined> {
  const maxThreads = options.maxThreads ?? 3;
  const maxThreadMessages = options.maxThreadMessages ?? 30;
  const threads = selectClassifyThreads(segments, links, maxThreads, maxThreadMessages);
  if (threads.length === 0) return undefined;

  const { prompt, messageByPromptId } = buildThreadPrompt(threads);
  const system = [
    "你是一个群聊行为标注器。",
    "你会看到若干完整对话线程，请为线程中的每条消息标注 role 和 intent。",
    "role=response 表示消息是在回应前面某人的话，intent 从 agree|ack|question|joke|roast|empathy|refuse 中选择。",
    "role=initiation 表示消息是在发起新话题或开启新一轮对话，intent 从 share|question|react|recall|opinion 中选择。",
    "如果消息不适合作为发言风格样本，例如纯状态、无意义、命令、通知、纯媒体或无法判断，使用 role=noise。",
    "必须参考完整线程上下文判断，不要只根据单条消息猜测。",
    "id 必须原样返回，不要改写、遗漏或补充消息。",
    '只返回 JSON：{"messages":[{"id":"t0-m0","role":"response","intent":"agree"}]}',
    "不要输出其他内容。",
  ].join("\n");

  try {
    const { text } = await generateText({ model, system, prompt, temperature: 0.1 });
    return parseModelAnnotations(text, messageByPromptId);
  } catch {
    return undefined;
  }
}

export async function generateChainSemantics(model: LanguageModel, chain: readonly string[], sample: LocalChainSample): Promise<string | undefined> {
  const sampleText = sample.turns.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n");
  const prompt = [
    "下面是一条真实群聊回复链：",
    `chain: ${chain.join(" -> ")}`,
    "sample:",
    sampleText,
    "",
    "请用一句自然中文描述：在什么场景下，群友会这样接。这句话应能作为模型选择接法时的语义提示。",
    "不要解释具体内容、人名、链接或事实，不要输出标签或 JSON，只输出一句 120 字以内的场景描述。",
  ].join("\n");

  try {
    const { text } = await generateText({ model, prompt, temperature: 0.2 });
    const semantics = text.trim().replace(/\s+/g, " ").slice(0, 120);
    return semantics.length > 0 ? semantics : undefined;
  } catch {
    return undefined;
  }
}

function selectClassifyThreads(
  segments: readonly ConversationSegment[],
  links: readonly MessageLink[],
  maxThreads: number,
  maxThreadMessages: number,
): ClassifyThread[] {
  const candidates = buildConversationChains(segments, links)
    .map((chain) => ({ chain, score: threadScore(chain.turns) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  const threads: ClassifyThread[] = [];
  let totalMessages = 0;
  let totalChars = 0;
  for (const candidate of candidates) {
    if (threads.length >= maxThreads) break;
    const selectedTurns = candidate.chain.turns.slice(-maxThreadMessages);
    const chars = selectedTurns.reduce((sum, turn) => sum + sanitizeForDisplay(turn.text).trim().length, 0);
    if (totalMessages + selectedTurns.length > MAX_MODEL_MESSAGES) continue;
    if (totalChars + chars > MAX_MODEL_CHARS) break;
    threads.push({ turns: selectedTurns });
    totalMessages += selectedTurns.length;
    totalChars += chars;
  }
  return threads;
}

function threadScore(turns: readonly MessageTurn[]): number {
  const texts = turns.map((turn) => sanitizeForDisplay(turn.text).trim()).filter((text) => text.length > 0);
  if (texts.length < 2) return 0;
  const userIds = new Set(turns.map((turn) => turn.userId));
  const uniqueTexts = new Set(texts);
  const repetitionRatio = uniqueTexts.size / texts.length;
  if (repetitionRatio < 0.5) return 0;
  return turns.length + userIds.size * 2 + Math.min(uniqueTexts.size, 8);
}

function buildThreadPrompt(threads: readonly ClassifyThread[]): { readonly prompt: string; readonly messageByPromptId: ReadonlyMap<string, MessageTurn> } {
  const lines: string[] = [];
  const messageByPromptId = new Map<string, MessageTurn>();

  for (const [threadIndex, thread] of threads.entries()) {
    lines.push(`## conversation thread ${threadIndex}`);
    const userLabels = new Map<string, string>();
    for (const [messageIndex, turn] of thread.turns.entries()) {
      const id = `t${threadIndex}-m${messageIndex}`;
      messageByPromptId.set(id, turn);
      const text = sanitizeForDisplay(turn.text).trim();
      if (text.length === 0) continue;
      lines.push(`[${id}] [${speakerLabel(turn.userId, userLabels)}] ${text}`);
    }
  }

  return { prompt: lines.join("\n"), messageByPromptId };
}

function speakerLabel(userId: string, labels: Map<string, string>): string {
  const existing = labels.get(userId);
  if (existing !== undefined) return existing;
  const next = `u${labels.size}`;
  labels.set(userId, next);
  return next;
}

function byFrequency(left: { readonly frequency: number }, right: { readonly frequency: number }): number {
  return right.frequency - left.frequency;
}

function parseModelAnnotations(text: string, messageByPromptId: ReadonlyMap<string, MessageTurn>): PatternSnapshot | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (!("messages" in parsed)) return undefined;

  const result = modelOutputSchema.safeParse(parsed);
  if (!result.success) return undefined;

  const responseCounts = new Map<string, { intent: ResponseIntent; phrase: string; sampleIds: string[] }>();
  const initiationCounts = new Map<string, { intent: InitiationIntent; phrase: string; sampleIds: string[] }>();

  for (const item of result.data.messages ?? []) {
    if (item.role === "noise") continue;
    const turn = messageByPromptId.get(item.id);
    if (!turn) continue;
    const phrase = patternPhrase(turn.text);
    if (phrase.length === 0) continue;

    if (item.role === "response") {
      if (!isResponseIntent(item.intent)) continue;
      const key = `${item.intent}:${phrase}`;
      const existing = responseCounts.get(key) ?? { intent: item.intent, phrase, sampleIds: [] };
      existing.sampleIds.push(turn.id);
      responseCounts.set(key, existing);
      continue;
    }

    if (!isInitiationIntent(item.intent)) continue;
    const key = `${item.intent}:${phrase}`;
    const existing = initiationCounts.get(key) ?? { intent: item.intent, phrase, sampleIds: [] };
    existing.sampleIds.push(turn.id);
    initiationCounts.set(key, existing);
  }

  return {
    responsePatterns: [...responseCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.sampleIds.length, sampleIds: item.sampleIds.slice(0, 3) }))
      .sort(byFrequency),
    initiationPatterns: [...initiationCounts.values()]
      .map((item) => ({ intent: item.intent, phrase: item.phrase, frequency: item.sampleIds.length, sampleIds: item.sampleIds.slice(0, 3) }))
      .sort(byFrequency),
  };
}

function isResponseIntent(value: string): value is ResponseIntent {
  return (RESPONSE_INTENTS as readonly string[]).includes(value);
}

function isInitiationIntent(value: string): value is InitiationIntent {
  return (INITIATION_INTENTS as readonly string[]).includes(value);
}
