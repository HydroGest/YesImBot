import type { UserModelMessage } from "@ai-sdk/provider-utils";
import { h, type Element } from "koishi";
import type { Session } from "koishi";

import type { ChannelScope } from "../channel.js";
import type { Platform } from "./types.js";
import { normalizeElements, sealElements } from "./utils/elements.js";

export function elementsToLiteral(elements: readonly Element[]): string {
  return elements.map((el) => el.toString()).join("");
}

export function literalToElements(content: string): Element[] {
  return h.normalize(content);
}

export function draftMessageFromSession(
  session: Session,
  receivedAt: number,
): Platform.Message | undefined {
  if (!session.channelId) return undefined;

  const rawElements = h.normalize(session.elements ?? session.content ?? "");

  const elements = normalizeElements(rawElements);

  return {
    source: { platform: session.platform, selfId: session.selfId },
    scope: {
      type: "channel",
      channelId: session.channelId,
      channelType: session.isDirect === true || session.subtype === "private" ? "private" : "group",
      ...(session.guildId ? { guildId: session.guildId } : {}),
    },
    sender: {
      id: session.userId ?? session.author?.id ?? "",
      ...(session.author?.name || (session as unknown as Record<string, unknown>).username
        ? {
            name: String(
              session.author?.name ?? (session as unknown as Record<string, unknown>).username,
            ),
          }
        : {}),
    },
    messageId: String(session.messageId ?? ""),
    receivedAt,
    elements,
    ...(session.timestamp ? { timestamp: +session.timestamp } : {}),
  };
}

export function sealMessage(message: Platform.Message): Platform.Message {
  return { ...message, elements: sealElements(message.elements) };
}

export function messageFromRecord(data: Platform.MessageRecord): Platform.Message {
  if (data.scope.channelType !== "private" && data.scope.channelType !== "group") {
    throw new Error("Platform message record channelType is required");
  }

  return {
    source: data.source,
    scope: data.scope,
    sender: data.sender,
    messageId: data.messageId,
    receivedAt: data.receivedAt,
    elements: literalToElements(data.content),
    ...(data.timestamp !== undefined ? { timestamp: data.timestamp } : {}),
  };
}

export function formatMessageHeader(
  message: Pick<Platform.Message, "sender" | "messageId" | "timestamp" | "receivedAt">,
  options: { includeMessageId: boolean },
): string {
  const instant = message.timestamp ?? message.receivedAt;
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));

  const sender = message.sender.name
    ? `${message.sender.name} (${message.sender.id})`
    : message.sender.id;

  const fields = [
    `time=${JSON.stringify(time)}`,
    ...(options.includeMessageId ? [`id=${JSON.stringify(message.messageId)}`] : []),
    `sender=${JSON.stringify(sender)}`,
  ];

  return `[${fields.join(" ")}]`;
}

export async function projectPlatformMessage(
  data: Platform.MessageRecord,
  options: {
    scope: ChannelScope;
    assetStore: {
      readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array>;
    };
    includeMessageId: boolean;
    onAssetMissing?: (assetId: string, cause: unknown) => void;
  },
): Promise<UserModelMessage> {
  const message = messageFromRecord(data);
  const header = formatMessageHeader(message, {
    includeMessageId: options.includeMessageId,
  });
  const parts: ModelPart[] = [{ type: "text", text: `${header}\n` }];
  await appendProjectedElements(sealElements(message.elements), parts, options);
  if (!parts.some((part) => part.type === "image")) {
    return {
      role: "user",
      content: parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    };
  }
  return {
    role: "user",
    content: parts,
  };
}

type ModelContentPart = Exclude<UserModelMessage["content"], string>[number];
type ModelPart = Extract<ModelContentPart, { type: "text" | "image" }>;

function pushText(parts: ModelPart[], text: string): void {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.type === "text") last.text += text;
  else parts.push({ type: "text", text });
}

async function appendProjectedElements(
  elements: readonly Element[],
  parts: ModelPart[],
  options: {
    scope: ChannelScope;
    assetStore: { readByAssetId(scope: ChannelScope, assetId: string): Promise<Uint8Array> };
    onAssetMissing?: (assetId: string, cause: unknown) => void;
  },
): Promise<void> {
  for (const element of elements) {
    if (element.type === "p") {
      pushText(parts, "<p>");
      await appendProjectedElements(element.children, parts, options);
      pushText(parts, "</p>");
      continue;
    }
    if (element.type === "img") {
      const assetId = typeof element.attrs.id === "string" ? element.attrs.id : undefined;
      const mime = typeof element.attrs.mime === "string" ? element.attrs.mime : undefined;
      if (assetId?.startsWith("asset_") && mime) {
        try {
          const bytes = await options.assetStore.readByAssetId(options.scope, assetId);
          parts.push({ type: "image", image: bytes, mediaType: mime });
        } catch (cause) {
          options.onAssetMissing?.(assetId, cause);
          pushText(parts, '<img unavailable="true"/>');
        }
        continue;
      }
    }
    pushText(parts, element.toString());
  }
}
