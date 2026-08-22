import type { AgentAssistantMessage, AgentEntry, AgentMessage } from "@yesimbot/agent-runtime";
import { createAssistantMessage } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "@yesimbot/agent-runtime";

const FINAL_STYLE_SYSTEM = [
  "你是这个群的群友，负责把 bot 即将发送的最终发言改得更像群友。",
  "必须保留原意、事实、引用、@、消息分段和必要信息，不能替 bot 做新的决定。",
  "可以缩短，删掉开场白、总结、解释、客套和机器味，但不能增加新事实。",
  "保持群友的短句、直接、接梗节奏和标点习惯。",
  "只输出改写后的最终消息文本，不要输出解释、JSON、markdown 代码块或额外说明。",
].join("\n");

export function isTextOnlyAssistant(message: AgentMessage): message is AgentAssistantMessage {
  if (message.role !== "assistant") return false;
  if (typeof message.content === "string") return message.content.trim().length > 0;
  if (!Array.isArray(message.content)) return false;
  if (message.content.some((part) => typeof part === "object" && part !== null && "type" in part && (part as { type?: unknown }).type === "tool-call")) {
    return false;
  }
  return renderAssistantText(message.content).trim().length > 0;
}

export function renderAssistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null || !("text" in part)) return "";
      if ((part as { type?: unknown }).type === "reasoning") return "";
      return String((part as { text?: unknown }).text ?? "");
    })
    .join("");
}

export function buildFinalStylePrompt(styleReference: string, replyText: string): { readonly system: string; readonly prompt: string } {
  return {
    system: FINAL_STYLE_SYSTEM,
    prompt: ["## 群聊风格 few-shot", styleReference, "## bot 即将发送的最终发言", replyText].join("\n\n"),
  };
}

// Runs before persistence and delivery, so reflection evaluates the same text users receive.
export async function rewriteAssistantEntries(entries: readonly AgentEntry[], model: LanguageModel, styleReference: string): Promise<AgentEntry[]> {
  if (styleReference.trim().length === 0) return [...entries];

  const rewritten: AgentEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || !isTextOnlyAssistant(entry.data)) {
      rewritten.push(entry);
      continue;
    }

    const original = entry.data;
    const replyText = renderAssistantText(original.content);
    const nextText = await rewriteFinalReply(model, styleReference, replyText);
    if (!nextText || nextText === replyText) {
      rewritten.push(entry);
      continue;
    }

    rewritten.push({
      ...entry,
      data: createAssistantMessage(nextText, {
        id: original.id,
        timestamp: original.timestamp,
        ...("usage" in original && original.usage !== undefined ? { usage: original.usage } : {}),
        ...("finishReason" in original && original.finishReason !== undefined ? { finishReason: original.finishReason } : {}),
        ...("providerOptions" in original && original.providerOptions !== undefined ? { providerOptions: original.providerOptions } : {}),
      }),
    });
  }
  return rewritten;
}

async function rewriteFinalReply(model: LanguageModel, styleReference: string, replyText: string): Promise<string | undefined> {
  if (replyText.trim().length === 0) return undefined;
  const { system, prompt } = buildFinalStylePrompt(styleReference, replyText);

  try {
    const { text } = await generateText({ model, system, prompt, temperature: 0.4 });
    const rewritten = normalizeModelOutput(text);
    return rewritten.length > 0 ? rewritten : undefined;
  } catch {
    return undefined;
  }
}

function normalizeModelOutput(text: string): string {
  return text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
