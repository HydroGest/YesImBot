import { h, type Element, type Session, Universal } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { MessageRecord } from "../event/index.js";
import { normalizeElements, sealElements } from "../shared/element.js";

export function draftMessageBase(session: Session): Omit<MessageRecord, "text"> | null {
  const scope = scopeFromSession(session);
  if (!scope || session.type !== "message-created") return null;

  // Strict admission: require elements array and non-empty messageId
  const rawElements = session.event.message?.elements ?? session.elements;
  if (!Array.isArray(rawElements)) return null;

  const rawMessageId = session.event.message?.id ?? session.messageId;
  if (typeof rawMessageId !== "string" || !rawMessageId) return null;

  // Capture source elements before any transformation
  const elements: readonly Element[] = rawElements;

  // Lift Satori resources from the event
  const event = session.event;
  const channel = (event.channel ?? {}) as Universal.Channel;
  const user = (event.user ?? {}) as Universal.User;
  const member = event.member as Universal.GuildMember | undefined;
  const guild = event.guild as Universal.Guild | undefined;

  // Use finite timestamp or Date.now()
  const timestamp = numberValue(session.timestamp) ?? numberValue(event.timestamp) ?? Date.now();

  // Extract extra Universal.Event fields (sn, login, referrer, etc.)
  const { type: _type, timestamp: _eventTs, message: _msg, content: _content, channel: _ch, user: _u, member: _m, guild: _g, ...extra } = event as unknown as Record<string, unknown>;

  return {
    ...extra,
    schemaVersion: 1,
    platform: scope.platform,
    selfId: scope.selfId,
    channel: { ...channel, id: scope.channelId, type: channel.type ?? 0 },
    user: {
      ...user,
      id: user.id ?? session.userId ?? session.author?.id ?? "",
      ...(user.name === undefined && session.author?.name ? { name: session.author.name } : {}),
    },
    ...(member ? { member } : {}),
    ...(guild ? { guild } : {}),
    messageId: rawMessageId,
    elements,
    timestamp,
  } as Omit<MessageRecord, "text">;
}

export function resolveFallbackMessage(base: Omit<MessageRecord, "text">): MessageRecord {
  // Create a separate working tree for text derivation
  const workingElements = normalizeElements([...base.elements]);
  const sealedElements = sealElements(workingElements);
  const text = sealedElements.map((element) => element.toString()).join("");

  return {
    ...base,
    text,
  };
}

function scopeFromSession(session: Session): ChannelScope | null {
  if (!session.platform || !session.selfId || !session.channelId) return null;
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    isDirect: session.isDirect,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
