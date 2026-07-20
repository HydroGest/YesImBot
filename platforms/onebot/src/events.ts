import type { Session } from "koishi";
import type { Platform } from "koishi-plugin-yesimbot/platform";

// ── data types ─────────────────────────────────────────────────

export interface MessageReaction {
  id: string;
  type: string;
  count: number;
}

export interface MessageReactionsUpdatedData {
  messageId: string;
  userId: string;
  reactions: MessageReaction[];
}

// ── augment PlatformEventVariants ──────────────────────────────

declare module "koishi-plugin-yesimbot/platform" {
  interface PlatformEventVariants {
    "onebot.message-reactions-updated": MessageReactionsUpdatedData;
  }
}

// ── refiner ────────────────────────────────────────────────────

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

export function refineMessageReactionsUpdated(
  session: Session,
): Platform.Event<"onebot.message-reactions-updated"> | undefined {
  const raw = (session as unknown as { onebot?: RawNotice }).onebot;
  if (!raw || raw.post_type !== "notice" || raw.notice_type !== "message_reactions_updated") {
    return undefined;
  }
  if (!raw.group_id || !raw.message_id || !raw.user_id) return undefined;

  const data: MessageReactionsUpdatedData = {
    messageId: String(raw.message_id),
    userId: String(raw.user_id),
    reactions: (raw.reactions ?? []).map((r) => ({
      id: String(r.emoji_id),
      type: String(r.emoji_type),
      count: r.count,
    })),
  };

  const content = `消息表态更新: ${data.messageId} (${data.reactions.length} reactions)`;

  return {
    source: { platform: session.platform, selfId: session.selfId },
    scope: {
      type: "channel",
      channelId: String(raw.group_id),
    },
    type: "onebot.message-reactions-updated",
    data,
    content,
  };
}
