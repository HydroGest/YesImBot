import { type Context, type Session } from "koishi";

import type { AssetStore } from "../asset.js";
import { assembleEvent, type EventRecord, type MessageRecord, type RecordBase } from "../messages/index.js";
import { persistElements } from "./resources.js";
import type { PlatformTranslator } from "./types.js";

export interface MessageReaction {
  id: string;
  type: string;
  count: number;
}

export interface MessageReactionsUpdated {
  messageId: string;
  userId: string;
  reactions: MessageReaction[];
}

type OneBotEventType = "notice.poke";

declare module "../messages/index.js" {
  interface EventMap {
    "notice.poke": {
      targetId: string;
      action: string;
    };
  }
}

export function createOneBotTranslator(ctx: Context): PlatformTranslator {
  return {
    platform: "onebot",
    async translate(base, session, store) {
      const event = translateOneBotEvent(base, session);
      if (event) return event;
      return translateOneBotMessage(ctx, base, session, store);
    },
  };
}

export function translateOneBotEvent(base: RecordBase, session: Session): EventRecord<OneBotEventType> | null {
  const { event } = session;
  if (event.type === "notice") {
    switch (event.subtype) {
      case "poke":
        return assembleEvent(base, {
          eventType: "notice.poke",
          targetId: String(event._data.target_id),
          action: "拍了拍",
          text: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
        });
      default:
        return null;
    }
  }
  return null;
}

export async function translateOneBotMessage(
  ctx: Context,
  base: RecordBase,
  session: Session,
  store: AssetStore,
): Promise<MessageRecord | null> {
  if (session.type !== "message-created" || !Array.isArray(session.elements)) return null;
  if (typeof session.messageId !== "string" || session.messageId.length === 0) return null;
  return {
    ...base,
    messageId: session.messageId,
    elements: await persistElements(ctx, session.elements, store),
  };
}
