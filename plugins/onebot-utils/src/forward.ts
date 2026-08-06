import type { OneBot } from "koishi-plugin-adapter-onebot";

import { formatAnimatedImageLabel, isAnimatedImage } from "./animated-image.js";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface ForwardToolInput {
  forwardId: string;
  offset?: number;
  limit?: number;
}

interface ForwardPage {
  messages: readonly ForwardMessage[];
  nextOffset?: number;
  tips?: string;
  overLimit?: true;
}

interface ForwardFailure {
  error: string;
}

interface ForwardReaderConfig {
  parseImages: boolean;
  maxForwardPageChars: number;
  attachImageSummary: boolean;
}

interface OneBotForwardNode {
  sender: OneBot.SenderInfo;
  time: OneBot.Message["time"];
  message: readonly OneBotForwardSegment[];
  raw_message?: OneBot.Payload["raw_message"];
}

interface OneBotTextSegment {
  type: "text";
  data: {
    text: string;
  };
}

interface OneBotImageSegment {
  type: "image";
  data: {
    summary: string;
    file: string;
    file_size?: string;
    sub_type?: unknown;
    subType?: unknown;
  };
}

interface OneBotNestedForwardSegment {
  type: "forward";
  data: {
    id: string;
    content?: readonly OneBotForwardNode[];
  };
}

interface OneBotRecordSegment {
  type: "record";
  data: object;
}

interface OneBotVideoSegment {
  type: "video";
  data: object;
}

interface OneBotFileSegment {
  type: "file";
  data: object;
}

type ForwardPart =
  | string
  | { image: readonly [summary: string, file: string, size: string | null] }
  | { forward: string };

type ForwardMessage = readonly [sender: string, time: string | null, content: readonly ForwardPart[]];

export type ForwardResult = ForwardPage | ForwardFailure;

type OneBotForwardSegment =
  | OneBotTextSegment
  | OneBotImageSegment
  | OneBotNestedForwardSegment
  | OneBotRecordSegment
  | OneBotVideoSegment
  | OneBotFileSegment;

export function createForwardReader(
  internal: OneBot.Internal,
  config: Readonly<ForwardReaderConfig>,
): (input: ForwardToolInput) => Promise<ForwardResult> {
  const cache = new Map<string, readonly ForwardMessage[]>();

  return async function readForwardPage(input) {
    const start = clampOffset(input.offset);
    const limit = clampLimit(input.limit);
    const records = cache.get(input.forwardId) ?? (await loadAndNormalize(input.forwardId));
    if (!records) return { error: `未找到合并转发消息: ${input.forwardId}` };

    return page(records, start, limit, config.maxForwardPageChars);
  };

  async function loadAndNormalize(forwardId: string): Promise<readonly ForwardMessage[] | undefined> {
    const response = await internal.getForwardMsg(forwardId);
    if (!Array.isArray(response)) return undefined;

    const nodes = response as unknown as readonly OneBotForwardNode[];
    const nestedForwards = new Map<string, readonly ForwardMessage[]>();
    const records = nodes.map((node) => normalizeNode(node, config, nestedForwards));

    cache.set(forwardId, records);
    for (const [nestedForwardId, nestedRecords] of nestedForwards) {
      cache.set(nestedForwardId, nestedRecords);
    }
    return records;
  }
}

function normalizeNode(
  node: OneBotForwardNode,
  config: Readonly<ForwardReaderConfig>,
  nestedForwards: Map<string, readonly ForwardMessage[]>,
): ForwardMessage {
  return [formatSender(node.sender), formatTime(node.time), normalizeSegments(node.message, config, nestedForwards)];
}

function formatSender(sender: OneBot.SenderInfo): string {
  const userId = String(sender.user_id);
  const displayName = sender.card || sender.nickname;

  return displayName && displayName !== userId ? `${displayName} (${userId})` : userId;
}

function formatTime(value: number): string | null {
  if (!Number.isFinite(value)) return null;

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : timeFormatter.format(date);
}

function normalizeSegments(
  segments: readonly OneBotForwardSegment[],
  config: Readonly<ForwardReaderConfig>,
  nestedForwards: Map<string, readonly ForwardMessage[]>,
): readonly ForwardPart[] {
  const parts: ForwardPart[] = [];

  for (const segment of segments) {
    switch (segment?.type) {
      case "text": {
        const text = (segment.data as { text?: unknown } | undefined)?.text;
        if (typeof text === "string") appendString(parts, text);
        else appendString(parts, "[未知消息段]");
        break;
      }
      case "image": {
        const data = segment.data as
          | { summary?: unknown; file?: unknown; file_size?: unknown; sub_type?: unknown; subType?: unknown }
          | undefined;
        if (typeof data?.summary !== "string" || typeof data.file !== "string") {
          appendString(parts, "[未知消息段]");
        } else if (config.parseImages) {
          parts.push({ image: [data.summary, data.file, formatFileSize(data.file_size)] });
        } else {
          appendString(
            parts,
            isAnimatedImage(data)
              ? formatAnimatedImageLabel({
                  attachImageSummary: config.attachImageSummary,
                  summary: data.summary,
                })
              : "[图片]",
          );
        }
        break;
      }
      case "forward": {
        const data = segment.data as { id?: unknown; content?: readonly OneBotForwardNode[] } | undefined;
        if (typeof data?.id !== "string") {
          appendString(parts, "[未知消息段]");
          break;
        }
        if (Array.isArray(data.content) && !nestedForwards.has(data.id)) {
          nestedForwards.set(
            data.id,
            data.content.map((node) => normalizeNode(node, config, nestedForwards)),
          );
        }
        parts.push({ forward: data.id });
        break;
      }
      case "record":
        appendString(parts, "[语音]");
        break;
      case "video":
        appendString(parts, "[视频]");
        break;
      case "file":
        appendString(parts, "[文件]");
        break;
      default:
        appendString(parts, "[未知消息段]");
    }
  }

  return parts;
}

function appendString(parts: ForwardPart[], value: string): void {
  const previous = parts.at(-1);
  if (typeof previous === "string") {
    parts[parts.length - 1] = previous + value;
  } else {
    parts.push(value);
  }
}

function formatFileSize(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;

  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes)) return null;
  if (bytes < 1000) return `${bytes} B`;

  const unit: readonly [number, string] =
    bytes < 1_000_000 ? [1000, "KB"] : bytes < 1_000_000_000 ? [1_000_000, "MB"] : [1_000_000_000, "GB"];
  return `${(bytes / unit[0]).toFixed(1)} ${unit[1]}`;
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30;
  return Math.min(60, Math.max(1, Math.trunc(value)));
}

function page(records: readonly ForwardMessage[], start: number, limit: number, budget: number): ForwardPage {
  if (start >= records.length) return { messages: [] };

  const messages: ForwardMessage[] = [];
  let chars = 0;
  let index = start;

  while (index < records.length && messages.length < limit) {
    const record = records[index]!;
    const recordChars = record[2].reduce((total, part) => total + (typeof part === "string" ? part.length : 0), 0);

    if (messages.length === 0 && recordChars > budget) {
      return {
        messages: [record],
        ...continuation(index + 1, records.length),
        overLimit: true,
      };
    }
    if (chars + recordChars > budget) break;

    messages.push(record);
    chars += recordChars;
    index += 1;
  }

  return {
    messages,
    ...continuation(index, records.length),
  };
}
function continuation(nextOffset: number, totalRecords: number) {
  if (nextOffset >= totalRecords) return {};

  return {
    nextOffset,
    tips: `还有 ${totalRecords - nextOffset} 条消息未读取；如需继续，请使用相同 forwardId 和 nextOffset ${nextOffset}。`,
  };
}
