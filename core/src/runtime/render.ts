import type { TextPart } from "@ai-sdk/provider-utils";
import type { AgentMessage } from "@yesimbot/agent-runtime";

function isTextPart(value: unknown): value is TextPart {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

export function extractAssistantTexts(messages: readonly AgentMessage[]): string[] {
  const texts: string[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    if (typeof message.content === "string") {
      if (message.content.trim().length > 0) {
        texts.push(message.content);
      }
      continue;
    }

    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part): part is TextPart => isTextPart(part))
        .map((part) => part.text)
        .join("");
      if (text.trim().length > 0) {
        texts.push(text);
      }
    }
  }

  return texts;
}
