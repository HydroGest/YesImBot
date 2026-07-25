import type { Session, Universal } from "koishi";
import type { EventRecord } from "koishi-plugin-yesimbot";

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

declare module "koishi-plugin-yesimbot" {
  interface EventMap {
    "notice.poke": {
      channel: Universal.Channel;
      target: Universal.User;
      user: Universal.User;
      selfId: string;
      action: string;
    };
  }
}

export function resolveOneBotEvent(session: Session): EventRecord<"notice.poke"> | null {
  const { event } = session;
  if (event.type === "notice") {
    switch (event.subtype) {
      case "poke": {
        const channel: Universal.Channel = event.channel ?? {
          id: session.channelId ?? "",
          type: 0,
        };
        const user: Universal.User = event.user ?? { id: session.userId ?? "" };
        const target: Universal.User = { id: String(event._data.target_id) };
        return {
          sn: event.sn,
          login: event.login,
          referrer: event.referrer,
          schemaVersion: 1,
          eventType: "notice.poke",
          platform: session.platform,
          selfId: session.selfId,
          channel,
          user,
          target,
          action: "拍了拍",
          text: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
          timestamp: session.timestamp,
        } satisfies EventRecord<"notice.poke">;
      }
      default:
        return null;
    }
  }
  return null;
}
