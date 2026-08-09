import { generateText, type LanguageModel } from "ai";
import { z } from "zod";

import type { InitiationPattern, MemeTemplate, ResponsePattern } from "./types.js";

interface TemplateCandidate {
  readonly template: string;
  readonly examples: readonly string[];
  readonly frequency: number;
}

const memeUsageSchema = z.object({
  usage: z.string().min(1).max(140),
});

export async function buildMemeTemplates(
  model: LanguageModel | undefined,
  responsePatterns: readonly ResponsePattern[],
  initiationPatterns: readonly InitiationPattern[],
  now = Date.now(),
): Promise<readonly MemeTemplate[]> {
  const phrases = [...responsePatterns, ...initiationPatterns]
    .map((pattern) => ({ phrase: pattern.phrase, frequency: pattern.frequency }))
    .filter((item) => item.phrase.length >= 3 && !item.phrase.includes("[") && !item.phrase.includes("]"));
  const candidates = findTemplateCandidates(phrases).slice(0, 3);
  const templates: MemeTemplate[] = [];

  for (const candidate of candidates) {
    const usage = model
      ? await summarizeUsage(model, candidate)
      : `本群近期高频使用 ${candidate.template.replace("{X}", "状态词")}，可替换 {X} 类推新变体。`;
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
    .map(({ slots: _slots, ...candidate }) => ({
      ...candidate,
      examples: [...new Set(candidate.examples)].slice(0, 6),
    }))
    .sort((left, right) => right.frequency - left.frequency);
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
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    const result = memeUsageSchema.safeParse(parsed);
    return result.success ? result.data.usage : undefined;
  } catch {
    return undefined;
  }
}
