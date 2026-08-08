import type { AgentEntry } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "ai";

import { sanitizeForDisplay } from "./text.js";

export interface GenerateReflectionOptions {
  readonly maxMessages?: number;
}

export async function reflectOnSentMessage(
  model: LanguageModel,
  styleBlock: string,
  sentText: string,
): Promise<string | undefined> {
  const text = sanitizeForDisplay(sentText).trim();
  if (text.length === 0 || styleBlock.trim().length === 0) return undefined;
  const prompt = [
    "## 群聊风格 few-shot",
    styleBlock,
    "## bot 最终发送的发言",
    text,
  ].join("\n\n");
  const system = [
    "你是一个发言风格反思器。",
    "根据群聊风格 few-shot，评价 bot 刚刚最终发送的这条发言是否像群友。",
    "只输出 2-3 句具体、可执行的改进建议。",
    "不要复述消息内容、人名、日期或事实。",
    "不要输出标签、JSON 或无关内容。",
  ].join("\n");

  try {
    const { text: generated } = await generateText({
      model,
      system,
      prompt,
      temperature: 0.2,
    });
    const reflection = generated.trim().replace(/\s+/g, " ").slice(0, 600);
    return reflection.length > 0 ? reflection : undefined;
  } catch {
    return undefined;
  }
}

export async function generateReflection(
  model: LanguageModel,
  styleBlock: string,
  entries: readonly AgentEntry[],
  options: GenerateReflectionOptions = {},
): Promise<string | undefined> {
  const maxMessages = options.maxMessages ?? 5;
  const recent = entries
    .filter(isAssistantEntry)
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-maxMessages);
  const texts = recent
    .map((entry) => sanitizeForDisplay(renderAssistantText(entry.data.content)).trim())
    .filter((text) => text.length > 0);
  if (texts.length === 0 || styleBlock.trim().length === 0) return undefined;

  const prompt = [
    "## 群聊风格 few-shot",
    styleBlock,
    "## bot 最近发言",
    ...texts.map((text, index) => `[${index + 1}] ${text}`),
  ].join("\n\n");
  const system = [
    "你是一个发言风格反思器。",
    "根据群聊风格 few-shot，评价 bot 最近几次发言是否像群友。",
    "只输出 2-3 句具体、可执行的改进建议。",
    "不要复述消息内容、人名、日期或事实。",
    "不要输出标签、JSON 或无关内容。",
  ].join("\n");

  try {
    const { text } = await generateText({
      model,
      system,
      prompt,
      temperature: 0.2,
    });
    const reflection = text.trim().replace(/\s+/g, " ").slice(0, 600);
    return reflection.length > 0 ? reflection : undefined;
  } catch {
    return undefined;
  }
}

function isAssistantEntry(
  entry: AgentEntry,
): entry is AgentEntry & { data: { role: "assistant"; content: unknown } } {
  return entry.type === "message" && entry.data.role === "assistant";
}

function renderAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null && "text" in item) {
        return String((item as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}
