import type { PlatformTranslator } from "./types.js";

export const defaultTranslator: PlatformTranslator = {
  platform: "*",
  async translate(base, session) {
    if (
      session.type !== "message-created" ||
      typeof session.messageId !== "string" ||
      session.messageId.length === 0 ||
      !Array.isArray(session.elements)
    )
      return null;
    return { ...base, messageId: session.messageId, elements: session.elements };
  },
};
