import type { Session, Universal } from "koishi";

import type { EventRecord } from "../../event/index.js";

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
      channel: Universal.Channel;
      target: Universal.User;
      user: Universal.User;
      selfId: string;
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
): EventRecord<"notice.poke" | "onebot.message-reactions-updated"> | null {
  const reactionEvent = resolveMessageReactionsUpdated(session);
  if (reactionEvent) return reactionEvent;

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

function resolveMessageReactionsUpdated(
  session: Session,
): EventRecord<"onebot.message-reactions-updated"> | null {
  if (!isMessageReactionsUpdatedNotice(session.onebot)) return null;

  const { group_id, message_id, user_id, reactions } = session.onebot;
  return {
    sn: session.event.sn,
    login: session.event.login,
    referrer: session.event.referrer,
    schemaVersion: 1,
    eventType: "onebot.message-reactions-updated",
    type: "onebot.message-reactions-updated",
    text: "Message reactions updated",
    platform: session.platform,
    selfId: session.selfId,
    channel: { id: String(group_id), type: 0 },
    reaction: {
      messageId: String(message_id),
      userId: String(user_id),
      reactions: reactions.map(({ emoji_id, emoji_type, count }) => ({
        id: String(emoji_id),
        type: String(emoji_type),
        count,
      })),
    },
    timestamp: session.timestamp,
  } satisfies EventRecord<"onebot.message-reactions-updated">;
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
