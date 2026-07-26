import type { Session } from "koishi";

import type { ResolvedEventDraft } from "../../event/index.js";

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

declare module "../../event/index.js" {
  interface EventMap {
    "notice.poke": {
      targetId: string;
      action: string;
    };
    "onebot.message-reactions-updated": {
      type: "onebot.message-reactions-updated";
      reaction: MessageReactionsUpdated;
    };
  }
}

export function resolveOneBotEvent(
  session: Session,
): ResolvedEventDraft<"notice.poke" | "onebot.message-reactions-updated"> | null {
  const reactionEvent = resolveMessageReactionsUpdated(session);
  if (reactionEvent) return reactionEvent;

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

function resolveMessageReactionsUpdated(
  session: Session,
): ResolvedEventDraft<"onebot.message-reactions-updated"> | null {
  if (!isMessageReactionsUpdatedNotice(session.onebot)) return null;

  const { group_id, message_id, user_id, reactions } = session.onebot;
  return {
    kind: "event",
    eventType: "onebot.message-reactions-updated",
    type: "onebot.message-reactions-updated",
    text: "Message reactions updated",
    reaction: {
      messageId: String(message_id),
      userId: String(user_id),
      reactions: reactions.map(({ emoji_id, emoji_type, count }) => ({
        id: String(emoji_id),
        type: String(emoji_type),
        count,
      })),
    },
  } satisfies ResolvedEventDraft<"onebot.message-reactions-updated">;
}

function isMessageReactionsUpdatedNotice(payload: unknown): payload is {
  readonly post_type: "notice";
  readonly notice_type: "message_reactions_updated";
  readonly group_id: string | number;
  readonly message_id: string | number;
  readonly user_id: string | number;
  readonly reactions: readonly {
    readonly emoji_id: string | number;
    readonly emoji_type: string | number;
    readonly count: number;
  }[];
} {
  if (!isRecord(payload)) return false;
  if (
    payload.post_type !== "notice" ||
    payload.notice_type !== "message_reactions_updated" ||
    !isProtocolIdentifier(payload.group_id) ||
    !isProtocolIdentifier(payload.message_id) ||
    !isProtocolIdentifier(payload.user_id) ||
    !Array.isArray(payload.reactions)
  ) {
    return false;
  }

  return payload.reactions.every(
    (reaction) =>
      isRecord(reaction) &&
      isProtocolIdentifier(reaction.emoji_id) &&
      isProtocolIdentifier(reaction.emoji_type) &&
      typeof reaction.count === "number",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProtocolIdentifier(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}
