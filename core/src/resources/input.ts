import { readFile, stat } from "node:fs/promises";
import type { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";

import { h, type Context, type Element, type Logger } from "koishi";

import type { AssetStore } from "./asset.js";
import type { ChannelResources } from "./index.js";

const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;
const BASE64_URL = /^base64:\/\/([\s\S]*)$/;
const MAX_IMAGES = 4;
const MAX_BYTES_PER_IMAGE = 5 * 1024 * 1024;
const MAX_FILES = 2;

/** 1 MiB of UTF-8 text already exceeds the read tool's character truncation; larger is useless to the model. */
const MAX_BYTES_PER_FILE = 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const RESOURCE_TIMEOUT_MS = 10_000;

/** Cheap pre-filter so a large binary is never downloaded; the UTF-8 check after download is authoritative. */
/* prettier-ignore */
const TEXT_FILE_EXTENSIONS: readonly string[] = [ "txt", "md", "markdown", "rst", "log", "csv", "tsv", "json", "jsonc", "yaml", "yml", "toml", "ini", "conf", "env", "properties", "xml", "html", "htm", "css", "svg", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte", "py", "rb", "rs", "go", "java", "kt", "kts", "scala", "swift", "c", "h", "cpp", "cc", "hpp", "cs", "php", "lua", "pl", "r", "m", "sh", "bash", "zsh", "fish", "ps1", "bat", "sql", "graphql", "proto", "patch", "diff" ] as const;

/** Content types that carry no signal about the real payload; the post-download checks stay authoritative. */
const AMBIGUOUS_TYPES: readonly string[] = ["application/octet-stream", "binary/octet-stream", "application/unknown"];
const BINARY_KINDS: readonly string[] = ["image", "audio", "video", "font"] as const;

type ResourceKind = "image" | "text";

interface ResourceBudget {
  images: number;
  files: number;
  bytes: number;
}

interface ResourceProbe {
  length: number | null;
  type: string | null;
}

/** Persists inbound image and restricted text-file elements while the Session is live. */
export async function persistElements(ctx: Context, elements: readonly Element[], resources: ChannelResources): Promise<Element[]> {
  const budget: ResourceBudget = { images: 0, files: 0, bytes: 0 };
  const prepared = await Promise.all(elements.map((element) => persistElement(ctx, element, resources.assets, budget)));
  const logger = ctx.logger("yesimbot.resources");
  const imageCount = countElements(prepared, "img");
  const fileCount = countElements(prepared, "file");
  if (imageCount || fileCount) {
    logger.debug("resources.input.persisted", { imageCount, fileCount });
  }
  return prepared;
}

async function persistElement(ctx: Context, element: Element, store: AssetStore, budget: ResourceBudget): Promise<Element> {
  if (element.type === "img") return storeImage(ctx, element, store, budget);
  if (element.type === "file") return storeTextFile(ctx, element, store, budget);
  if (element.children.length === 0) return element;
  return h(element.type, element.attrs, await Promise.all(element.children.map((child) => persistElement(ctx, child, store, budget))));
}

async function storeImage(ctx: Context, element: Element, store: AssetStore, budget: ResourceBudget): Promise<Element> {
  if (typeof element.attrs.src !== "string" || budget.images >= MAX_IMAGES) return element;
  budget.images += 1;
  try {
    const data = await loadResource(ctx, element.attrs.src, "image", Math.min(MAX_BYTES_PER_IMAGE, MAX_TOTAL_BYTES - budget.bytes));
    if (budget.bytes + data.byteLength > MAX_TOTAL_BYTES) return element;
    budget.bytes += data.byteLength;
    return h("img", {
      id: await store.put(data),
      ...(element.attrs.subType === undefined ? {} : { subType: element.attrs.subType }),
      ...(element.attrs.sub_type === undefined ? {} : { sub_type: element.attrs.sub_type }),
      ...(element.attrs.summary === undefined ? {} : { summary: element.attrs.summary }),
    });
  } catch {
    return element;
  }
}

async function storeTextFile(ctx: Context, element: Element, store: AssetStore, budget: ResourceBudget): Promise<Element> {
  if (typeof element.attrs.src !== "string" || budget.files >= MAX_FILES) return element;
  const filename = fileName(element);
  if (!filename || !hasTextFileExtension(filename)) return element;
  budget.files += 1;
  try {
    const data = await loadResource(ctx, element.attrs.src, "text", Math.min(MAX_BYTES_PER_FILE, MAX_TOTAL_BYTES - budget.bytes));
    if (budget.bytes + data.byteLength > MAX_TOTAL_BYTES || !isUtf8Text(data)) return element;
    budget.bytes += data.byteLength;
    return h("file", { id: await store.put(data), title: filename });
  } catch {
    return element;
  }
}

function fileName(element: Element): string | undefined {
  for (const key of ["title", "file"] as const) {
    const value = element.attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function hasTextFileExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return false;
  return TEXT_FILE_EXTENSIONS.includes(filename.slice(dot + 1).toLowerCase());
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).length > 0;
  } catch {
    return false;
  }
}

async function loadResource(ctx: Context, src: string, kind: ResourceKind, maxBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Resource download timed out")), RESOURCE_TIMEOUT_MS);
  try {
    return await loadResourceBytes(ctx, src, kind, controller.signal, maxBytes);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadResourceBytes(ctx: Context, src: string, kind: ResourceKind, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const data = decodeDataUrl(src, maxBytes);
  if (data) return data;
  const base64 = decodeBase64Url(src, maxBytes);
  if (base64) return base64;
  signal.throwIfAborted();
  if (src.startsWith("file:")) return loadLocalFile(src, signal, maxBytes);
  return loadRemote(ctx, src, kind, signal, maxBytes);
}

async function loadRemote(ctx: Context, src: string, kind: ResourceKind, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
  const probe = await headProbe(ctx, src);
  if (probe && ((probe.length !== null && probe.length > maxBytes) || !matchesKind(probe.type, kind))) {
    throw new Error("Resource rejected by HEAD pre-check");
  }
  const response = await ctx.http(src, { responseType: "stream", signal });
  return readBoundedStream(response.data, signal, maxBytes);
}

async function headProbe(ctx: Context, url: string): Promise<ResourceProbe | null> {
  let headers: Headers;
  try {
    headers = await ctx.http.head(url, { timeout: RESOURCE_TIMEOUT_MS });
  } catch {
    return null;
  }
  const rawLength = headers.get("content-length");
  const rawType = headers.get("content-type");
  return {
    length: rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : null,
    type: rawType === null ? null : rawType.split(";")[0]!.trim().toLowerCase(),
  };
}

function matchesKind(type: string | null, kind: ResourceKind): boolean {
  if (type === null) return true;
  if (kind === "image") return type.startsWith("image/") || AMBIGUOUS_TYPES.includes(type);
  return !BINARY_KINDS.some((prefix) => type.startsWith(`${prefix}/`));
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

async function readBoundedStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
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
  const decoded = base64 ? new Uint8Array(Buffer.from(payload, "base64")) : new TextEncoder().encode(decodeURIComponent(payload));
  if (decoded.byteLength > maxBytes) throw new Error("Resource exceeds byte limit");
  return decoded;
}

function decodeBase64Url(src: string, maxBytes: number): Uint8Array | null {
  const match = BASE64_URL.exec(src);
  if (!match) return null;
  const payload = match[1]!;
  if (Math.ceil(payload.length / 4) * 3 > maxBytes) throw new Error("Resource exceeds byte limit");
  const decoded = new Uint8Array(Buffer.from(payload, "base64"));
  if (decoded.byteLength > maxBytes) throw new Error("Resource exceeds byte limit");
  return decoded;
}

function countElements(elements: readonly Element[], type: string): number {
  let count = 0;
  const visit = (element: Element): void => {
    if (element.type === type) count += 1;
    for (const child of element.children) visit(child);
  };
  for (const element of elements) visit(element);
  return count;
}
