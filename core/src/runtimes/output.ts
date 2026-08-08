import { h, type Element } from "koishi";

import type { ChannelResources } from "../resources/index.js";

const MARK = "\u0000";
const RESOURCE_SOURCE = /^(asset|artifact|workspace):\/\//;

export class OutputQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (cause: unknown) => void }> = [];
  private done = false;
  private failure: unknown;

  public push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  public close(failure?: unknown): void {
    this.done = true;
    this.failure = failure;
    for (const waiter of this.waiters.splice(0)) {
      if (failure) waiter.reject(failure);
      else waiter.resolve({ value: undefined as never, done: true });
    }
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      if (this.values.length) yield this.values.shift()!;
      else if (this.done) {
        if (this.failure) throw this.failure;
        return;
      } else yield await new Promise<T>((resolve, reject) => this.waiters.push({ resolve: (result) => resolve(result.value), reject }));
    }
  }
}

export async function prepareOutputSegments(segments: readonly (readonly Element[])[], resources: ChannelResources, signal?: AbortSignal): Promise<Element[][]> {
  const prepared: Element[][] = [];
  for (const segment of segments) {
    const next = await Promise.all(segment.map((element) => prepareElement(element, resources, signal)));
    const filtered = next.filter((element): element is Element => element !== undefined);
    if (filtered.length) prepared.push(filtered);
  }
  return prepared;
}

export function parseReply(raw: string): Element[][] {
  const source = raw.replaceAll(MARK, "");
  const nonce = `${MARK}t${Math.random().toString(36).slice(2)}`;
  const captured: string[] = [];
  let masked = "";
  let cursor = 0;
  for (;;) {
    const open = source.indexOf("<text>", cursor);
    if (open < 0) { masked += source.slice(cursor); break; }
    masked += source.slice(cursor, open);
    const start = open + 6;
    const close = source.indexOf("</text>", start);
    masked += `${nonce}${captured.length}${MARK}`;
    captured.push(close < 0 ? source.slice(start) : source.slice(start, close));
    if (close < 0) break;
    cursor = close + 7;
  }
  const restore = (element: Element): Element[] => {
    if (element.type === "inner_thought") return [];
    if (element.type !== "text") return [h(element.type, element.attrs, element.children.flatMap(restore))];
    const content = `${element.attrs.content ?? ""}`;
    const values: Element[] = [];
    let offset = 0;
    for (;;) {
      const start = content.indexOf(nonce, offset);
      if (start < 0) {
        if (offset < content.length) values.push(h.text(content.slice(offset)));
        return values;
      }
      const end = content.indexOf(MARK, start + nonce.length);
      if (end < 0) return [h.text(content)];
      if (offset < start) values.push(h.text(content.slice(offset, start)));
      const value = captured[Number(content.slice(start + nonce.length, end))];
      if (value) values.push(h.text(value));
      offset = end + 1;
    }
  };
  const split = (elements: readonly Element[]): Element[][] => {
    const segments: Element[][] = [];
    let current: Element[] = [];
    const flush = () => {
      if (current.some((element) => element.type !== "text" || `${element.attrs.content ?? ""}`.trim())) segments.push(current);
      current = [];
    };
    for (const element of elements) {
      if (element.type === "message") {
        flush();
        segments.push(...split(element.children));
      } else current.push(element);
    }
    flush();
    return segments;
  };
  return split(h.parse(masked).flatMap(restore));
}

async function prepareElement(element: Element, resources: ChannelResources, signal?: AbortSignal): Promise<Element | undefined> {
  if (element.children.length) return h(element.type, element.attrs, (await Promise.all(element.children.map((child) => prepareElement(child, resources, signal)))).filter((child): child is Element => child !== undefined));
  const src = element.attrs.src;
  if (typeof src !== "string" || !RESOURCE_SOURCE.test(src) || (element.type !== "img" && element.type !== "file")) return element;
  if (element.type === "img" && !/^asset:\/\/[a-f0-9]{32}$/.test(src)) {
    // ponytail: full 32-hex ID required for output resolution; prefix/short IDs are not resolvable
    const scheme = src.slice(0, src.indexOf(":"));
    if (scheme === "asset") return undefined;
  }
  const opened = await resources.open(src, signal);
  if (!opened) return undefined;
  const detected = detectMediaType(opened.bytes);
  if (element.type === "img" && !detected) return undefined;
  const mediaType = detected ?? opened.mediaType ?? "application/octet-stream";
  return h(element.type, { ...element.attrs, src: `data:${mediaType};base64,${Buffer.from(opened.bytes).toString("base64")}` });
}

function detectMediaType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return undefined;
}
