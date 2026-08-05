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
const MAX_FILES = 2;
/** 1 MiB of UTF-8 text already exceeds the read tool's character truncation; larger is useless to the model. */
const MAX_BYTES_PER_FILE = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const RESOURCE_TIMEOUT_MS = 10_000;

/** Cheap pre-filter so a large binary is never downloaded; the UTF-8 check after download is authoritative. */
const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "env",
  "properties",
  "xml",
  "html",
  "htm",
  "css",
  "svg",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "php",
  "lua",
  "pl",
  "r",
  "m",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "sql",
  "graphql",
  "proto",
  "patch",
  "diff",
]);

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

interface ResourceBudget {
  images: number;
  files: number;
  bytes: number;
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
  const budget = { images: 0, files: 0, bytes: 0 };
  return {
    ...base,
    messageId: session.messageId,
    elements: await Promise.all(session.elements.map((element) => storeResources(ctx, element, store, budget))),
  };
}

async function storeResources(
  ctx: Context,
  element: Element,
  store: AssetStore,
  budget: ResourceBudget,
): Promise<Element> {
  if (element.type === "img") return storeImage(ctx, element, store, budget);
  if (element.type === "file") return storeTextFile(ctx, element, store, budget);
  if (element.children.length === 0) return element;
  return h(
    element.type,
    element.attrs,
    await Promise.all(element.children.map((child) => storeResources(ctx, child, store, budget))),
  );
}

async function storeImage(ctx: Context, element: Element, store: AssetStore, budget: ResourceBudget): Promise<Element> {
  if (typeof element.attrs.src !== "string" || budget.images >= MAX_IMAGES) return element;
  budget.images += 1;
  try {
    const data = await loadOneBotResource(
      ctx,
      element.attrs.src,
      Math.min(MAX_BYTES_PER_IMAGE, MAX_TOTAL_BYTES - budget.bytes),
    );
    if (budget.bytes + data.byteLength > MAX_TOTAL_BYTES) return element;
    budget.bytes += data.byteLength;
    return h("img", { id: await store.put(data) });
  } catch {
    return element;
  }
}

async function storeTextFile(
  ctx: Context,
  element: Element,
  store: AssetStore,
  budget: ResourceBudget,
): Promise<Element> {
  if (typeof element.attrs.src !== "string" || budget.files >= MAX_FILES) return element;
  const filename = oneBotFileName(element);
  if (!filename || !hasTextFileExtension(filename)) return element;
  budget.files += 1;
  try {
    const data = await loadOneBotResource(
      ctx,
      element.attrs.src,
      Math.min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES - budget.bytes),
    );
    if (budget.bytes + data.byteLength > MAX_TOTAL_BYTES || !isUtf8Text(data)) return element;
    budget.bytes += data.byteLength;
    return h("file", { id: await store.put(data), title: filename });
  } catch {
    return element;
  }
}

function oneBotFileName(element: Element): string | undefined {
  for (const key of ["title", "file"] as const) {
    const value = element.attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function hasTextFileExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return false;
  return TEXT_FILE_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).length > 0;
  } catch {
    return false;
  }
}

async function loadOneBotResource(ctx: Context, src: string, maxBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Resource download timed out")), RESOURCE_TIMEOUT_MS);
  try {
    return await loadOneBotResourceBytes(ctx, src, controller.signal, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOneBotResourceBytes(
  ctx: Context,
  src: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  const data = decodeDataUrl(src, maxBytes);
  if (data) return data;
  signal.throwIfAborted();
  if (src.startsWith("file:")) return loadLocalFile(src, signal, maxBytes);
  const response = await ctx.http(src, { responseType: "stream", signal });
  return readBoundedStream(response.data, signal, maxBytes);
}

async function loadLocalFile(src: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const path = fileURLToPath(src);
  const entry = await stat(path);
  if (entry.size > maxBytes) throw new Error("Resource exceeds byte limit");
  signal.throwIfAborted();
  const data = new Uint8Array(await readFile(path, { signal }));
  if (data.byteLength > maxBytes) throw new Error("Resource exceeds byte limit");
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
        await reader.cancel(new Error("Resource exceeds byte limit"));
        throw new Error("Resource exceeds byte limit");
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

function decodeDataUrl(src: string, maxBytes: number): Uint8Array | null {
  const match = DATA_URL.exec(src);
  if (!match) return null;
  const [, _mime, base64, payload] = match;
  if (base64 && Math.ceil(payload.length / 4) * 3 > maxBytes) throw new Error("Resource exceeds byte limit");
  if (!base64 && payload.length > maxBytes) throw new Error("Resource exceeds byte limit");
  const decoded = base64
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  if (decoded.byteLength > maxBytes) throw new Error("Resource exceeds byte limit");
  return decoded;
}
