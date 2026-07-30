import type { OneBot } from "koishi-plugin-adapter-onebot";

import type {
  ForwardMessage,
  ForwardPage,
  ForwardPart,
  ForwardReaderConfig,
  ForwardToolInput,
  OneBotForwardNode,
  OneBotForwardSegment,
} from "./types.js";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function createForwardReader(
  internal: OneBot.Internal,
  config: Readonly<ForwardReaderConfig>,
): (input: ForwardToolInput) => Promise<ForwardPage> {
  const cache = new Map<string, readonly ForwardMessage[]>();

  return async function readForwardPage(input) {
    const start = clampOffset(input.offset);
    const limit = clampLimit(input.limit);
    const records = cache.get(input.messageId) ?? (await loadAndNormalize(input.messageId));

    return page(records, start, limit, config.maxForwardPageChars);
  };

  async function loadAndNormalize(messageId: string): Promise<readonly ForwardMessage[]> {
    const nodes = (await internal.getForwardMsg(messageId)) as unknown as readonly OneBotForwardNode[];
    const records = nodes.map((node) => normalizeNode(node, config));

    cache.set(messageId, records);
    return records;
  }
}

function normalizeNode(
  node: OneBotForwardNode,
  config: Readonly<ForwardReaderConfig>,
): ForwardMessage {
  return [formatSender(node.sender), formatTime(node.time), normalizeSegments(node.message, config)];
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
          | { summary?: unknown; file?: unknown; file_size?: unknown }
          | undefined;
        if (typeof data?.summary !== "string" || typeof data.file !== "string") {
          appendString(parts, "[未知消息段]");
        } else if (config.parseImages) {
          parts.push({ image: [data.summary, data.file, formatFileSize(data.file_size)] });
        } else {
          appendString(parts, "[图片]");
        }
        break;
      }
      case "forward": {
        const id = (segment.data as { id?: unknown } | undefined)?.id;
        if (typeof id === "string") parts.push({ forward: id });
        else appendString(parts, "[未知消息段]");
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
    bytes < 1_000_000
      ? [1000, "KB"]
      : bytes < 1_000_000_000
        ? [1_000_000, "MB"]
        : [1_000_000_000, "GB"];
  return `${(bytes / unit[0]).toFixed(1)} ${unit[1]}`;
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 10;
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function page(
  records: readonly ForwardMessage[],
  start: number,
  limit: number,
  budget: number,
): ForwardPage {
  if (start >= records.length) return { messages: [] };

  const messages: ForwardMessage[] = [];
  let chars = 0;
  let index = start;

  while (index < records.length && messages.length < limit) {
    const record = records[index]!;
    const recordChars = record[2].reduce(
      (total, part) => total + (typeof part === "string" ? part.length : 0),
      0,
    );

    if (messages.length === 0 && recordChars > budget) {
      return {
        messages: [record],
        ...(index + 1 < records.length ? { nextOffset: index + 1 } : {}),
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
    ...(index < records.length ? { nextOffset: index } : {}),
  };
}
