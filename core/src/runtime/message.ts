import { createCustomMessage, type AgentPlugin } from "@yesimbot/agent-runtime";
import { Session } from "koishi";

import type { ChannelScope } from "../channel.js";
import type { PlatformAuthor, PlatformMessage, PlatformSource } from "../platform.js";

export type { PlatformMessage } from "../platform.js";

export type ChannelType = "private" | "group";
export type MessageRoute = { action: "ignore" | "append" | "send" | "join" };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function getChannelScope(session: Session): ChannelScope {
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

export function createMessageRoute(session: Session, options: { isBusy: boolean }): MessageRoute {
  if (isSelfMessage(session)) {
    return { action: "ignore" };
  }

  const replyEligible = getChannelType(session) === "private" || mentionsSelf(session);
  if (!replyEligible) {
    return { action: "append" };
  }

  return { action: options.isBusy ? "join" : "send" };
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

function createPlatformSource(session: Session): PlatformSource {
  return {
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId!,
    conversationType: getChannelType(session),
  };
}

function createPlatformAuthor(session: Session): PlatformAuthor {
  const authorId = getAuthorId(session) ?? "";
  const authorName = firstString(
    session.username,
    session.author?.name,
    session.author?.username,
    session.event?.user?.name,
    session.event?.user?.username,
  );
  const authorNick = firstString(session.author?.nick, session.event?.user?.nick);

  return {
    id: authorId,
    ...(authorName ? { name: authorName } : {}),
    ...(authorNick ? { nick: authorNick } : {}),
  };
}

export function createPlatformMessage(session: Session) {
  const messageId = firstString(session.messageId, session.event?.message?.id);
  const timestamp = session.timestamp ?? Date.now();
  const data: PlatformMessage = {
    version: 1,
    source: createPlatformSource(session),
    author: createPlatformAuthor(session),
    message: {
      messageId: messageId!,
      content: session.content ?? "",
      timestamp,
    },
  };

  return createCustomMessage("athena.platform.message", data, { id: messageId, timestamp });
}

export const platformMessagePlugin: AgentPlugin = {
  name: "core.platform-message",
  toModelMessages(message) {
    if (message.role !== "custom" || message.type !== "athena.platform.message") {
      return undefined;
    }

    const data = message.data;
    const display = data.author.nick || data.author.name || data.author.id;
    return {
      role: "user",
      content: `[${display}]: ${data.message.content}`,
    };
  },
};
