import { readFile, stat } from "node:fs/promises";
import type { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";

import { h, type Context, type Element } from "koishi";

import type { ResolveContext } from "../../gateway/index.js";

const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;

export async function freezeOneBotImages(
  ctx: Context,
  elements: readonly Element[],
  freezeImage: ResolveContext["freezeImage"],
): Promise<Element[]> {
  return Promise.all(elements.map((element) => freezeOneBotElement(ctx, element, freezeImage)));
}

async function freezeOneBotElement(
  ctx: Context,
  element: Element,
  freezeImage: ResolveContext["freezeImage"],
): Promise<Element> {
  if (element.type === "img") {
    if (typeof element.attrs.src === "string") {
      return freezeImage(element, (signal, maxBytes) =>
        loadOneBotImage(ctx, element.attrs.src as string, signal, maxBytes),
      );
    }
    if (typeof element.attrs.id === "string" && typeof element.attrs.mime === "string")
      return element;
    return h("img", { unavailable: "true" });
  }
  if (!element.children.length) return element;
  return h(
    element.type,
    element.attrs,
    await freezeOneBotImages(ctx, element.children, freezeImage),
  );
}

async function loadOneBotImage(
  ctx: Context,
  src: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ data: Uint8Array; mime?: string }> {
  const data = decodeDataImage(src, maxBytes);
  if (data) return data;

  signal.throwIfAborted();
  if (src.startsWith("file:")) return loadFileImage(src, signal, maxBytes);

  const response = await ctx.http(src, { responseType: "stream", signal });

  return {
    data: await readBoundedStream(response.data, signal, maxBytes),
    mime: response.headers.get("content-type")?.split(";", 1)[0],
  };
}

async function loadFileImage(
  src: string,
  signal: AbortSignal,
  maxBytes: number,
): Promise<{ data: Uint8Array }> {
  const path = fileURLToPath(src);
  const entry = await stat(path);
  if (entry.size > maxBytes) throw new Error("Image exceeds byte limit");
  signal.throwIfAborted();
  const data = new Uint8Array(await readFile(path, { signal }));
  if (data.byteLength > maxBytes) throw new Error("Image exceeds byte limit");
  return { data };
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

function decodeDataImage(
  src: string,
  maxBytes: number,
): { data: Uint8Array; mime?: string } | null {
  const match = DATA_URL.exec(src);
  if (!match) return null;
  const [, mime, base64, payload] = match;
  if (base64 && Math.ceil(payload.length / 4) * 3 > maxBytes)
    throw new Error("Image exceeds byte limit");
  if (!base64 && payload.length > maxBytes) throw new Error("Image exceeds byte limit");
  const decoded = base64
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new TextEncoder().encode(decodeURIComponent(payload));
  if (decoded.byteLength > maxBytes) throw new Error("Image exceeds byte limit");
  return {
    data: decoded,
    mime,
  };
}
