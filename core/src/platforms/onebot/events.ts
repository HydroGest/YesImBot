import type { Session, Universal } from "koishi";
import type { EventRecord } from "koishi-plugin-yesimbot";

const GROUP_CHANNEL_TYPE = 0 satisfies Universal.Channel.Type;

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

interface PokeNoticeData {
  post_type: "notice";
  notice_type: "notify";
  sub_type: "poke";
  self_id: number;
  group_id: number;
  user_id: number;
  target_id: number;
  time: number;
  raw_info: [];
}

export function resolveOneBotEvent(session: Session): EventRecord<"notice.poke"> | null {
  const { event } = session;
  if (event.type === "notice") {
    switch (event.subtype) {
      case "poke":
        return {
          type: "notice.poke",
          platform: session.platform,
          selfId: session.selfId,
          channel: event.channel,
          user: event.user,
          target: {
            id: event._data.target_id,
          },
          action: "拍了拍",
          content: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
        } as EventRecord<"notice.poke">;
      default:
        return null;
    }
  }
  return null;
}
