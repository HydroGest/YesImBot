import type { UserModelMessage } from "@ai-sdk/provider-utils";
import { h, type Element } from "koishi";

import type { ChannelScope } from "../channel/index.js";
import type { AssetStore } from "../shared/asset.js";
import type { Event } from "./index.js";

export interface FormatEventOptions {
  readonly scope: ChannelScope;
  readonly assetStore: Pick<AssetStore, "readByAssetId">;
  readonly includeMessageId: boolean;
  readonly onAssetMissing?: (assetId: string, cause: unknown) => void;
}

type ModelContentPart = Exclude<UserModelMessage["content"], string>[number];
type ModelPart = Extract<ModelContentPart, { type: "text" | "image" }>;

export async function formatEvent(
  event: Event,
  options: FormatEventOptions,
): Promise<UserModelMessage | undefined> {
  if (!event.data.content) return undefined;

  const parts: ModelPart[] = isMessageEvent(event)
    ? [{ type: "text", text: `${formatHeader(event, options)}\n` }]
    : [];
  await appendFrozenElements(h.normalize(event.data.content), parts, options);

  if (!parts.some((part) => part.type === "image")) {
    return {
      role: "user",
      content: parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
    };
  }
  return { role: "user", content: parts };
}

function isMessageEvent(event: Event): event is Event<"message"> {
  return event.data.type === "message";
}

function formatHeader(
  event: Event<"message">,
  options: Pick<FormatEventOptions, "includeMessageId">,
): string {
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.data.timestamp ?? event.timestamp));
  const displayName = event.data.member?.name ?? event.data.user.name;
  const sender = displayName ? `${displayName} (${event.data.user.id})` : event.data.user.id;
  const fields = [
    `time=${JSON.stringify(time)}`,
    `sender=${JSON.stringify(sender)}`,
    ...(options.includeMessageId ? [`id=${JSON.stringify(event.data.message.id)}`] : []),
  ];

  return `[${fields.join(" ")}]`;
}

function pushText(parts: ModelPart[], text: string): void {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.type === "text") last.text += text;
  else parts.push({ type: "text", text });
}

async function appendFrozenElements(
  elements: readonly Element[],
  parts: ModelPart[],
  options: FormatEventOptions,
): Promise<void> {
  for (const element of elements) {
    if (element.type === "p") {
      pushText(parts, "<p>");
      await appendFrozenElements(element.children, parts, options);
      pushText(parts, "</p>");
      continue;
    }
    if (element.type === "img") {
      const assetId = typeof element.attrs.id === "string" ? element.attrs.id : undefined;
      const mime = typeof element.attrs.mime === "string" ? element.attrs.mime : undefined;
      if (assetId?.startsWith("asset_") && mime) {
        try {
          const image = await options.assetStore.readByAssetId(options.scope, assetId);
          parts.push({ type: "image", image, mediaType: mime });
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
