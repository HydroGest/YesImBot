import type { Session } from "koishi";

import type { ResolvedEventDraft } from "../../messages.js";

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

declare module "../../messages.js" {
  interface EventMap {
    "notice.poke": {
      targetId: string;
      action: string;
    };
  }
}

export function resolveOneBotEvent(session: Session): ResolvedEventDraft<OneBotEventType> | null {
  const { event } = session;
  if (event.type === "notice") {
    switch (event.subtype) {
      case "poke": {
        return {
          kind: "event",
          eventType: "notice.poke",
          targetId: String(event._data.target_id),
          action: "拍了拍",
          text: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
        } satisfies ResolvedEventDraft<"notice.poke">;
      }
      default:
        return null;
    }
  }
  return null;
}
