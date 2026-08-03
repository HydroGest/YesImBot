import type { AgentEntry, AgentMessage } from "@yesimbot/agent-runtime";
import type { AssistantContent } from "ai";
import type { Element } from "koishi";

export function filterEntriesForCompression(entries: readonly AgentEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.data as AgentMessage;

    if (msg.role === "tool") continue;

    if (msg.role === "custom") {
      const custom = msg;
      if (custom.type === "yesimbot.message") {
        const text = extractElementsText(custom.data.elements);
        if (text) lines.push(`[${custom.data.user?.name || custom.data.user?.id || "user"}]: ${text}`);
      } else if (custom.type === "yesimbot.event") {
        if (custom.data.text) lines.push(`[事件]: ${custom.data.text}`);
      }
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractAssistantText(msg.content);
      if (text) lines.push(`[assistant]: ${text}`);
      continue;
    }
  }

  return lines.join("\n");
}

function extractAssistantText(content: AssistantContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text as string)
    .join("");
}

function extractElementsText(elements: readonly Element[]): string {
  if (!Array.isArray(elements)) return "";
  return elements
    .map((el) => {
      if (el.type === "text") return (el.attrs?.content as string) || "";
      if (el.type === "img" || el.type === "image") return "[图片]";
      if (el.type === "file") return "[文件]";
      if (el.type === "at") return `@${(el.attrs?.name as string) || (el.attrs?.id as string) || ""}`;
      if (el.children) return extractElementsText(el.children);
      return "";
    })
    .filter(Boolean)
    .join("");
}
