import { readFile, stat } from "node:fs/promises";
import type { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";

import { h, type Context, type Element, type Session } from "koishi";
import type {} from "koishi-plugin-adapter-onebot";

import type { AssetStore } from "../asset.js";
import { assembleEvent, type EventRecord, type MessageRecord, type RecordBase } from "../messages.js";
import type { PlatformTranslator } from "./types.js";

const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;
const MAX_IMAGES = 4;
const MAX_BYTES_PER_IMAGE = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;

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

type OneBotEventType = "notice.poke";

declare module "../messages.js" {
  interface EventMap {
    "notice.poke": {
      targetId: string;
      action: string;
    };
  }
}

export function createOneBotTranslator(ctx: Context): PlatformTranslator {
  return {
    platform: "onebot",
    async translate(base, session, store) {
      const event = translateOneBotEvent(base, session);
      if (event) return event;
      return translateOneBotMessage(ctx, base, session, store);
    },
  };
}

export function translateOneBotEvent(base: RecordBase, session: Session): EventRecord<OneBotEventType> | null {
  const { event } = session;
  if (event.type === "notice") {
    switch (event.subtype) {
      case "poke":
        return assembleEvent(base, {
          eventType: "notice.poke",
          targetId: String(event._data.target_id),
          action: "拍了拍",
          text: `${event._data.user_id} 拍了拍 ${event._data.target_id}`,
        });
      default:
        return null;
    }
  }
  return null;
}

export async function translateOneBotMessage(
  ctx: Context,
  base: RecordBase,
  session: Session,
  store: AssetStore,
): Promise<MessageRecord | null> {
  if (session.type !== "message-created" || !Array.isArray(session.elements)) return null;
  if (typeof session.messageId !== "string" || session.messageId.length === 0) return null;
  const budget = { count: 0, bytes: 0 };
  return {
    ...base,
    messageId: session.messageId,
    elements: await Promise.all(session.elements.map((element) => storeImages(ctx, element, store, budget))),
  };
}

async function storeImages(
  ctx: Context,
  element: Element,
  store: AssetStore,
  budget: { count: number; bytes: number },
): Promise<Element> {
  if (element.type === "img") {
    if (typeof element.attrs.src !== "string" || budget.count >= MAX_IMAGES) return element;
    budget.count += 1;
    try {
      const data = await loadOneBotImage(
        ctx,
        element.attrs.src,
        Math.min(MAX_BYTES_PER_IMAGE, MAX_TOTAL_BYTES - budget.bytes),
      );
      if (budget.bytes + data.byteLength > MAX_TOTAL_BYTES) return element;
      budget.bytes += data.byteLength;
      return await store.put(data);
    } catch {
      return element;
    }
  }
  if (element.children.length === 0) return element;
  return h(
    element.type,
    element.attrs,
    await Promise.all(element.children.map((child) => storeImages(ctx, child, store, budget))),
  );
}

async function loadOneBotImage(ctx: Context, src: string, maxBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Image download timed out")), IMAGE_TIMEOUT_MS);
  try {
    return await loadOneBotImageBytes(ctx, src, controller.signal, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOneBotImageBytes(
  ctx: Context,
  src: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  const data = decodeDataImage(src, maxBytes);
  if (data) return data;
  signal.throwIfAborted();
  if (src.startsWith("file:")) return loadFileImage(src, signal, maxBytes);
  const response = await ctx.http(src, { responseType: "stream", signal });
  return readBoundedStream(response.data, signal, maxBytes);
}

async function loadFileImage(src: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const path = fileURLToPath(src);
  const entry = await stat(path);
  if (entry.size > maxBytes) throw new Error("Image exceeds byte limit");
  signal.throwIfAborted();
  const data = new Uint8Array(await readFile(path, { signal }));
  if (data.byteLength > maxBytes) throw new Error("Image exceeds byte limit");
  return data;
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => void reader.cancel(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel(new Error("Image exceeds byte limit"));
        throw new Error("Image exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function decodeDataImage(src: string, maxBytes: number): Uint8Array | null {
  const match = DATA_URL.exec(src);
  if (!match) return null;
  const [, _mime, base64, payload] = match;
  if (base64 && Math.ceil(payload.length / 4) * 3 > maxBytes) throw new Error("Image exceeds byte limit");
  if (!base64 && payload.length > maxBytes) throw new Error("Image exceeds byte limit");
  const decoded = base64
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  if (decoded.byteLength > maxBytes) throw new Error("Image exceeds byte limit");
  return decoded;
}
