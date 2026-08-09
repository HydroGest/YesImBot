import { createAssistantMessage, createCustomMessage, createMessageEntry, type AgentEntry } from "@yesimbot/agent-runtime";
import type { Element } from "koishi";

export function humanMessage(
  id: string,
  messageId: string,
  userId: string,
  userName: string,
  timestamp: number,
  text: string,
  extraElements: readonly Element[] = [],
): AgentEntry {
  const message = createCustomMessage(
    "yesimbot.message",
    {
      platform: "test",
      selfId: "bot-1",
      channel: { id: "room-1", type: 0 },
      user: { id: userId, name: userName },
      messageId,
      elements: [{ type: "text", attrs: { content: text }, children: [] }, ...extraElements],
    },
    { id: `${id}-message`, timestamp },
  );
  return createMessageEntry(message, { id, timestamp }) as unknown as AgentEntry;
}

export function assistantMessage(id: string, timestamp: number, text: string): AgentEntry {
  return createMessageEntry(createAssistantMessage(text, { id: `${id}-assistant`, timestamp }), { id, timestamp }) as unknown as AgentEntry;
}

export function textElement(content: string): Element {
  return { type: "text", attrs: { content }, children: [] } as unknown as Element;
}

export function quoteElement(messageId: string, kind: "quote" | "reply" = "reply"): Element {
  return { type: kind, attrs: { id: messageId }, children: [] } as unknown as Element;
}

export function atElement(userId: string): Element {
  return { type: "at", attrs: { id: userId, name: userId }, children: [] } as unknown as Element;
}
