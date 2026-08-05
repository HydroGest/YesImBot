import { type Context, type Session } from "koishi";

import { MessageRecord } from "../messages.js";
import { persistElements } from "./resources.js";
import type { PlatformTranslator } from "./types.js";

export function createDefaultTranslator(ctx: Context): PlatformTranslator {
  return {
    platform: "*",
    async translate(base, session, store) {
      if (!isMessageSession(session)) return null;
      const elements = session.elements;
      if (!elements) return null;
      return {
        ...base,
        messageId: session.messageId,
        elements: await persistElements(ctx, elements, store),
      } as MessageRecord;
    },
  };
}

function isMessageSession(session: Session): boolean {
  return (
    session.type === "message-created" &&
    typeof session.messageId === "string" &&
    session.messageId.length > 0 &&
    Array.isArray(session.elements)
  );
}
