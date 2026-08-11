import type { AgentEntry, AgentMessage } from "@yesimbot/agent-runtime";
import { generateText, type AssistantContent, type LanguageModel } from "ai";
import type { Element } from "koishi";

export function filterEntriesForCompression(entries: readonly AgentEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.data as AgentMessage;
    if (message.role === "tool") continue;
    if (message.role === "custom") {
      const custom = message as AgentMessage & { type?: string; data?: { user?: { id?: string; name?: string }; elements?: Element[]; text?: string } };
      if (custom.type === "yesimbot.message") {
        const text = elementsText(custom.data?.elements);
        if (text) lines.push(`[${custom.data?.user?.name ?? custom.data?.user?.id ?? "user"}]: ${text}`);
      } else if (custom.type === "yesimbot.event" && custom.data?.text) lines.push(`[事件]: ${custom.data.text}`);
    } else if (message.role === "assistant") {
      const text = assistantText(message.content);
      if (text) lines.push(`[assistant]: ${text}`);
    }
  }
  return lines.join("\n");
}

export async function executeCompact(input: {
  readonly model: LanguageModel;
  readonly personaName: string;
  readonly persona: string;
  readonly previousMemory: string;
  readonly conversation: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  const { text } = await generateText({
    model: input.model,
    system: `你正在为 ${input.personaName} 压缩长期对话记忆。保留关系、事实、偏好、未完成事项和重要上下文，不编造内容。`,
    prompt: `<persona>\n${input.persona}\n</persona>\n\n<previous_memory>\n${input.previousMemory || "(none)"}\n</previous_memory>\n\n<conversation>\n${input.conversation}\n</conversation>`,
    abortSignal: input.signal,
  });
  const summary = text.trim();
  if (!summary) throw new Error("Compaction produced an empty summary.");
  return summary;
}

function assistantText(content: AssistantContent): string {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
      : "";
}

function elementsText(elements?: readonly Element[]): string {
  return (elements ?? [])
    .map((element) =>
      element.type === "text"
        ? String(element.attrs.content ?? "")
        : element.type === "img" || element.type === "image"
          ? "[图片]"
          : element.type === "file"
            ? "[文件]"
            : element.type === "at"
              ? `@${String(element.attrs.name ?? element.attrs.id ?? "")}`
              : elementsText(element.children),
    )
    .filter(Boolean)
    .join("");
}
