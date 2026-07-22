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
    "onebot.message-reactions-updated": {
      channel: Universal.Channel;
      reaction: MessageReactionsUpdated;
    };
  }
}

interface RawNotice {
  post_type: string;
  notice_type: string;
  group_id: number | string;
  message_id: number | string;
  user_id: number | string;
  reactions: Array<{
    emoji_id: number | string;
    emoji_type: number | string;
    count: number;
  }>;
}

export function resolveOneBotEvent(
  session: Session,
): EventRecord<"onebot.message-reactions-updated"> | null {
  const raw = (session as unknown as { onebot?: RawNotice }).onebot;
  if (!raw || raw.post_type !== "notice" || raw.notice_type !== "message_reactions_updated") {
    return null;
  }
  if (!raw.group_id || !raw.message_id || !raw.user_id) return null;

  return {
    type: "onebot.message-reactions-updated",
    platform: session.platform,
    selfId: session.selfId,
    timestamp: session.timestamp ?? Date.now(),
    channel: { id: String(raw.group_id), type: GROUP_CHANNEL_TYPE },
    reaction: {
      messageId: String(raw.message_id),
      userId: String(raw.user_id),
      reactions: (raw.reactions ?? []).map((reaction) => ({
        id: String(reaction.emoji_id),
        type: String(reaction.emoji_type),
        count: reaction.count,
      })),
    },
  } as EventRecord<"onebot.message-reactions-updated">;
}
