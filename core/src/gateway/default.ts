import { Session } from "koishi";

import { MessageRecord } from "../messages.js";
import type { PlatformTranslator } from "./types.js";

export const defaultTranslator: PlatformTranslator = {
  platform: "*",
  async translate(base, session) {
    if (!isMessageSession(session)) return null;
    return { ...base, messageId: session.messageId, elements: session.elements } as MessageRecord;
  },
};

function isMessageSession(session: Session): boolean {
  return (
    session.type === "message-created" &&
    typeof session.messageId === "string" &&
    session.messageId.length > 0 &&
    Array.isArray(session.elements)
  );
}
