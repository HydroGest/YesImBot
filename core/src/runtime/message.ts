import { createCustomMessage } from "@yesimbot/agent-runtime";
import { Session } from "koishi";

import type { Platform } from "../platform/index.js";
import { elementsToLiteral } from "../platform/message.js";

export type ChannelType = "private" | "group";
export type MessageClassification = "ignore" | "append" | "reply";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

export function getAuthorId(
  session: Pick<Session, "userId" | "author" | "event">,
): string | undefined {
  return firstString(session.userId, session.author?.id, session.event?.user?.id);
}

export function isSelfMessage(
  session: Pick<Session, "userId" | "selfId" | "author" | "event">,
): boolean {
  return getAuthorId(session) === session.selfId;
}

export function getChannelType(session: Pick<Session, "subtype" | "isDirect">): ChannelType {
  return session.isDirect === true || session.subtype === "private" ? "private" : "group";
}

export function getChannelScope(session: Session): import("../channel.js").ChannelScope {
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId!,
  };
}

export function mentionsSelf(session: Pick<Session, "selfId" | "content" | "elements">): boolean {
  if (
    session.elements?.some(
      (element) => element.type === "at" && String(element.attrs?.id) === session.selfId,
    )
  ) {
    return true;
  }

  const content = session.content ?? "";
  const id = escapeRegExp(session.selfId);
  return new RegExp(`<at\\s+[^>]*id=["']?${id}["']?[^>]*/?>`).test(content);
}

export function classifyMessage(
  session: Pick<
    Session,
    "userId" | "selfId" | "author" | "event" | "subtype" | "isDirect" | "content" | "elements"
  >,
): MessageClassification {
  if (isSelfMessage(session)) {
    return "ignore";
  }

  return getChannelType(session) === "private" || mentionsSelf(session) ? "reply" : "append";
}

export function createPlatformMessage(message: Platform.Message) {
  const data: Platform.MessageRecord = {
    source: message.source,
    scope: message.scope,
    sender: message.sender,
    messageId: message.messageId,
    receivedAt: message.receivedAt,
    content: elementsToLiteral(message.elements),
    ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
  };
  return createCustomMessage("athena.platform.message", data, {
    id: message.messageId,
    timestamp: message.timestamp ?? message.receivedAt,
  });
}
