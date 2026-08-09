import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

import { modelCacheId, type ModelCache } from "./model-cache.js";
import type { MemeTemplate } from "./types.js";

const memeUsageSchema = z.object({ usage: z.string().min(1).max(140) });

const semanticTemplateSchema = z.object({
  templates: z.array(z.object({ template: z.string().min(1).max(60), examples: z.array(z.string()).min(2).max(5), usage: z.string().min(1).max(140) })).max(3),
});

interface TemplateCandidate {
  readonly template: string;
  readonly examples: readonly string[];
  readonly frequency: number;
  readonly usage?: string;
}

export interface MemePhraseInput {
  readonly phrase: string;
  readonly frequency: number;
}

export async function buildMemeTemplates(
  model: LanguageModel | undefined,
  phrases: readonly MemePhraseInput[],
  now = Date.now(),
  cache?: ModelCache,
): Promise<readonly MemeTemplate[]> {
  const key = model ? cache?.key(["meme", modelCacheId(model), phrases]) : undefined;
  const produce = async (): Promise<readonly MemeTemplate[]> => {
  const normalized = phrases.filter((item) => item.phrase.length >= 3 && !item.phrase.includes("[") && !item.phrase.includes("]"));
  const heuristic = [...findTemplateCandidates(normalized), ...findRepetitionCandidates(normalized)];
  const semantic = model ? await summarizeSemanticTemplates(model, normalized) : [];
  const candidates = [...heuristic, ...semantic]
    .filter((candidate, index, all) => all.findIndex((item) => item.template === candidate.template) === index)
    .sort((left, right) => right.frequency - left.frequency)
    .slice(0, 3);
  const templates: MemeTemplate[] = [];

  for (const candidate of candidates) {
    let usage = candidate.usage;
    if (!usage && model) usage = await summarizeUsage(model, candidate);
    if (!usage) {
      usage = candidate.template.includes("× N")
        ? `本群近期高频复读 ${candidate.template.replace(" × N", "")}，重复次数可随情绪增加。`
        : `本群近期高频使用 ${candidate.template.replace("{X}", "状态词")}，可替换 {X} 类推新变体。`;
    }
    if (!usage) continue;
    templates.push({
      template: candidate.template,
      examples: candidate.examples.slice(0, 4),
      usage,
      frequency: candidate.frequency,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }

  return templates;
  };
  return cache && key ? cache.getOrProduce(key, produce) : produce();
}

function findTemplateCandidates(items: readonly { readonly phrase: string; readonly frequency: number }[]): TemplateCandidate[] {
  const candidates = new Map<string, { template: string; examples: string[]; frequency: number; slots: Set<string> }>();

  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const a = items[left]!.phrase;
      const b = items[right]!.phrase;
      if (a === b || a.length < 3 || b.length < 3) continue;

      const prefixLength = commonPrefixLength(a, b);
      const suffixLength = commonSuffixLength(a, b, prefixLength);
      if (prefixLength < 1 || suffixLength < 1 || prefixLength + suffixLength >= Math.min(a.length, b.length)) continue;

      const slotA = a.slice(prefixLength, a.length - suffixLength);
      const slotB = b.slice(prefixLength, b.length - suffixLength);
      if (!slotA || !slotB || slotA === slotB) continue;

      const template = `${a.slice(0, prefixLength)}{X}${a.slice(a.length - suffixLength)}`;
      if (template.includes("@") || (/^\d+$/.test(slotA) && /^\d+$/.test(slotB))) continue;
      const existing = candidates.get(template) ?? { template, examples: [], frequency: 0, slots: new Set<string>() };
      existing.examples.push(a, b);
      existing.frequency += items[left]!.frequency + items[right]!.frequency;
      existing.slots.add(slotA);
      existing.slots.add(slotB);
      candidates.set(template, existing);
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.slots.size >= 2)
    .map(({ slots: _slots, ...candidate }) => ({ ...candidate, examples: [...new Set(candidate.examples)].slice(0, 4) }))
    .sort((left, right) => right.frequency - left.frequency);
}

function findRepetitionCandidates(items: readonly { readonly phrase: string; readonly frequency: number }[]): TemplateCandidate[] {
  const byUnit = new Map<string, { unit: string; examples: string[]; frequency: number; repeatCounts: Set<number> }>();

  for (const item of items) {
    const unit = minimalRepeatUnit(item.phrase);
    if (!unit || /^\p{P}+$/u.test(unit)) continue;
    const existing = byUnit.get(unit) ?? { unit, examples: [], frequency: 0, repeatCounts: new Set<number>() };
    existing.examples.push(item.phrase);
    existing.frequency += item.frequency;
    existing.repeatCounts.add(item.phrase.length / unit.length);
    byUnit.set(unit, existing);
  }

  return [...byUnit.values()]
    .filter((candidate) => candidate.repeatCounts.size >= 2)
    .map(({ unit, examples, frequency }) => ({ template: `${unit} × N`, examples: [...new Set(examples)].slice(0, 4), frequency }));
}

function minimalRepeatUnit(value: string): string | undefined {
  for (let length = 1; length <= Math.min(5, Math.floor(value.length / 2)); length += 1) {
    if (value.length % length !== 0) continue;
    const unit = value.slice(0, length);
    if (unit.repeat(value.length / length) === value) return unit;
  }
  return undefined;
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let length = 0;
  const max = Math.min(left.length - prefixLength, right.length - prefixLength);
  while (length < max && left[left.length - 1 - length] === right[right.length - 1 - length]) length += 1;
  return length;
}

async function summarizeUsage(model: LanguageModel, candidate: TemplateCandidate): Promise<string | undefined> {
  const prompt = [
    "以下短语可能来自同一个梗模板：",
    ...candidate.examples.map((example) => `- ${example}`),
    `模板：${candidate.template}`,
    '请只输出 JSON：{"usage":"一句中文说明什么时候用、怎么类推"}。',
    "不要编造样本，不要输出其他内容。",
  ].join("\n");

  try {
    const { text } = await generateText({ model, prompt, temperature: 0.2 });
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = memeUsageSchema.safeParse(parsed);
    return result.success ? result.data.usage : undefined;
  } catch {
    return undefined;
  }
}

async function summarizeSemanticTemplates(model: LanguageModel, phrases: readonly MemePhraseInput[]): Promise<TemplateCandidate[]> {
  const allowed = new Set(phrases.map((item) => item.phrase));
  const prompt = [
    "以下是某个群聊的高频短语：",
    ...phrases.slice(0, 20).map((item) => `- ${item.phrase}`),
    "请找出 2-3 个最像群聊梗模板的模式，只使用上面列出的短语作为 examples。",
    '输出 JSON：{"templates":[{"template":"模板字符串，可变部分用 {X} 或 N 表示","examples":["短语"],"usage":"一句中文说明什么时候用、怎么类推"}]}',
    "不要编造不在列表里的 examples。",
  ].join("\n");

  try {
    const { text } = await generateText({ model, prompt, temperature: 0.2 });
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = semanticTemplateSchema.safeParse(parsed);
    if (!result.success) return [];

    return result.data.templates.flatMap((item) => {
      if (item.template.includes("@")) return [];
      const examples = [...new Set(item.examples.filter((example) => allowed.has(example)))];
      if (examples.length < 2) return [];
      const frequency = examples.reduce((sum, example) => sum + (phrases.find((phrase) => phrase.phrase === example)?.frequency ?? 0), 0);
      return [{ template: item.template, examples, frequency, usage: item.usage }];
    });
  } catch {
    return [];
  }
}
