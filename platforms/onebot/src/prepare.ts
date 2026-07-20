import { h, type Context, type Element } from "koishi";
import type { Platform } from "koishi-plugin-yesimbot/platform";

const DATA_URL = /^data:([^;,]+)(;base64)?,([\s\S]*)$/;
const DECODE_CHUNK_CHARS = 16 * 1024;

function unavailableImage(): Element {
  return h("img", { unavailable: "true" });
}

function appendBytes(
  output: Uint8Array,
  offset: number,
  bytes: Uint8Array,
  maxBytes: number,
): number {
  if (offset + bytes.byteLength > maxBytes) {
    throw new Error("decoded image exceeds byte limit");
  }
  output.set(bytes, offset);
  return offset + bytes.byteLength;
}

function decodeBase64Limited(payload: string, maxBytes: number): Uint8Array {
  if (payload.length > maxBytes * 4 || payload.length % 4 !== 0) {
    throw new Error("encoded image exceeds byte limit");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    throw new Error("invalid base64 image data");
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const estimatedBytes = (payload.length / 4) * 3 - padding;
  if (estimatedBytes > maxBytes) throw new Error("decoded image exceeds byte limit");

  const output = new Uint8Array(estimatedBytes);
  let offset = 0;
  for (let index = 0; index < payload.length; index += DECODE_CHUNK_CHARS) {
    const bytes = new Uint8Array(
      Buffer.from(payload.slice(index, index + DECODE_CHUNK_CHARS), "base64"),
    );
    offset = appendBytes(output, offset, bytes, maxBytes);
  }
  return output;
}

function decodePercentLimited(payload: string, maxBytes: number): Uint8Array {
  if (payload.length > maxBytes * 3) throw new Error("encoded image exceeds byte limit");

  const output = new Uint8Array(maxBytes);
  const encoder = new TextEncoder();
  let offset = 0;
  let index = 0;
  while (index < payload.length) {
    if (payload[index] === "%") {
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error("invalid percent-encoded image data");
      if (offset >= maxBytes) throw new Error("decoded image exceeds byte limit");
      output[offset++] = Number.parseInt(hex, 16);
      index += 3;
      continue;
    }

    let end = Math.min(payload.length, index + DECODE_CHUNK_CHARS);
    const percent = payload.indexOf("%", index);
    if (percent !== -1 && percent < end) end = percent;
    const bytes = encoder.encode(payload.slice(index, end));
    offset = appendBytes(output, offset, bytes, maxBytes);
    index = end;
  }
  return output.slice(0, offset);
}

function decodeDataImage(src: string, maxBytes: number): Uint8Array {
  const match = DATA_URL.exec(src);
  if (!match) throw new Error("invalid data URL");
  const [, _declaredMime, base64, payload] = match;
  return base64 ? decodeBase64Limited(payload, maxBytes) : decodePercentLimited(payload, maxBytes);
}

async function readLimitedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => void reader.cancel(controller.signal.reason);
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("image stream must yield bytes");
      if (size + value.byteLength > maxBytes) {
        controller.abort(new Error("image exceeds byte limit"));
        await reader.cancel(controller.signal.reason);
        throw new Error("image exceeds byte limit");
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    controller.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function downloadImageBytes(
  ctx: Context,
  src: string,
  budget: Platform.ImageBudget,
): Promise<Uint8Array> {
  if (src.startsWith("data:")) return decodeDataImage(src, budget.maxBytesPerImage);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Image download timed out", "TimeoutError"));
  }, budget.timeoutMs);
  try {
    const stream = await ctx.http.get<ReadableStream<Uint8Array>>(src, {
      responseType: "stream",
      timeout: budget.timeoutMs,
      signal: controller.signal,
    });
    return await readLimitedStream(stream, budget.maxBytesPerImage, controller);
  } finally {
    clearTimeout(timer);
  }
}

function collectImageNodes(elements: readonly Element[], output: Element[] = []): Element[] {
  for (const element of elements) {
    if (element.type === "img" || element.type === "image") {
      output.push(element);
    }
    output.push(...collectImageNodes(element.children));
  }
  return output;
}

function rebuildElements(
  elements: readonly Element[],
  replacements: ReadonlyMap<Element, Element>,
): Element[] {
  return elements.map((element) => {
    const replacement = replacements.get(element);
    if (replacement) return replacement;
    if (!element.children.length) return element;
    return h(element.type, element.attrs, rebuildElements(element.children, replacements));
  });
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await worker(values[index], index);
      }
    }),
  );
  return results;
}

/**
 * Freeze OneBot image URLs into verified private assets before persistence.
 */
export async function prepareOneBotMessage(
  ctx: Context,
  prepareCtx: Platform.PrepareContext,
): Promise<Element[]> {
  const { message, images, budget } = prepareCtx;
  const imageNodes = collectImageNodes(message.elements);
  if (imageNodes.length === 0) return [...message.elements];

  const eligible = imageNodes.slice(0, budget.maxImages);
  const replacements = new Map<Element, Element>();
  for (const element of imageNodes.slice(budget.maxImages)) {
    replacements.set(element, unavailableImage());
  }

  const remoteEligible = eligible.filter((element) => typeof element.attrs.src === "string");

  const candidates = await mapConcurrent(remoteEligible, budget.concurrency, async (element) => {
    try {
      return await downloadImageBytes(ctx, String(element.attrs.src), budget);
    } catch {
      return undefined;
    }
  });

  let totalBytes = 0;
  for (let index = 0; index < remoteEligible.length; index += 1) {
    const element = remoteEligible[index];
    const bytes = candidates[index];
    if (!bytes || totalBytes + bytes.byteLength > budget.maxTotalBytes) {
      replacements.set(element, unavailableImage());
      continue;
    }
    try {
      const { assetId, mime } = await images.put(bytes);
      totalBytes += bytes.byteLength;
      replacements.set(element, h("img", { id: assetId, mime }));
    } catch {
      replacements.set(element, unavailableImage());
    }
  }

  return rebuildElements(message.elements, replacements);
}
