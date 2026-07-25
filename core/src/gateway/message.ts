import { type Session, Universal } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { MessageRecord } from "../event/index.js";
import { normalizeElements, sealElements } from "../shared/element.js";

export function draftMessageBase(session: Session): Omit<MessageRecord, "text"> | null {
  const scope = scopeFromSession(session);
  if (!scope || session.type !== "message-created") return null;

  const elements = session.elements;
  if (!Array.isArray(elements)) return null;

  const messageId = session.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) return null;

  const {
    type: _type,
    timestamp: eventTimestamp,
    message: _message,
    channel,
    user,
    ...resources
  } = session.event;
  const timestamp = numberValue(session.timestamp) ?? numberValue(eventTimestamp) ?? Date.now();

  return {
    ...resources,
    schemaVersion: 1,
    platform: scope.platform,
    selfId: scope.selfId,
    channel: {
      ...channel,
      id: scope.channelId,
      type: channel?.type ?? Universal.Channel.Type.TEXT,
    },
    user: {
      ...user,
      id: user?.id ?? session.userId ?? session.author?.id ?? "",
      ...(user?.name === undefined && session.author?.name ? { name: session.author.name } : {}),
    },
    messageId,
    elements,
    timestamp,
  } satisfies Omit<MessageRecord, "text">;
}

export function resolveFallbackMessage(base: Omit<MessageRecord, "text">): MessageRecord {
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
