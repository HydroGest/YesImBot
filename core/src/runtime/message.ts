import { createCustomMessage } from "@yesimbot/agent-runtime";

import type { ChannelScope } from "../channel.js";
import type { MessageRoutingConfig } from "../config.js";
import type { Platform } from "../platform/index.js";
import { elementsToLiteral } from "../platform/message.js";

export type MessageClassification = "ignore" | "append" | "reply";

export function getChannelScope(message: Platform.Message): ChannelScope {
  return {
    platform: message.source.platform,
    selfId: message.source.selfId,
    channelId: message.scope.channelId,
  };
}

export function isSelfMessage(message: Platform.Message): boolean {
  return message.sender.id === message.source.selfId;
}

export function mentionsSelf(message: Platform.Message): boolean {
  return message.elements.some(
    (element) => element.type === "at" && String(element.attrs?.id) === message.source.selfId,
  );
}

export function classifyMessage(
  message: Platform.Message,
  routing: MessageRoutingConfig,
): MessageClassification {
  if (isSelfMessage(message)) return "ignore";
  if (message.scope.channelType === "private") return routing.direct;
  if (mentionsSelf(message)) return routing.mention;
  return routing.group;
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
