import { Element, h } from "koishi";

const RAW_OPEN = "<raw>";
const RAW_CLOSE = "</raw>";
const SEPARATOR = "sep";
const INNER_THOUGHT = "inner_thought";
const MARK = "\u0000";

export function parseReply(raw: string): Element[][] {
  const source = raw.replaceAll(MARK, "");
  const nonce = `${MARK}r${Math.random().toString(36).slice(2)}`;
  const captured: string[] = [];
  const masked = maskRaw(source, nonce, captured);
  return partition(h.parse(masked))
    .map((segment) => segment.map((element) => restore(element, nonce, captured)))
    .filter((segment) => !isBlank(segment));
}

function maskRaw(source: string, nonce: string, captured: string[]): string {
  let masked = "";
  let cursor = 0;
  for (;;) {
    const open = source.indexOf(RAW_OPEN, cursor);
    if (open < 0) return masked + source.slice(cursor);
    masked += source.slice(cursor, open);
    const start = open + RAW_OPEN.length;
    const close = source.indexOf(RAW_CLOSE, start);
    masked += `${nonce}${captured.length}${MARK}`;
    captured.push(close < 0 ? source.slice(start) : source.slice(start, close));
    if (close < 0) return masked;
    cursor = close + RAW_CLOSE.length;
  }
}

function partition(tree: readonly Element[]): Element[][] {
  const segments: Element[][] = [];
  let current: Element[] = [];
  for (const element of tree) {
    if (element.type === INNER_THOUGHT) continue;
    if (element.type === SEPARATOR) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(strip(element));
  }
  segments.push(current);
  return segments;
}

function strip(element: Element): Element {
  if (element.children.length === 0) return element;
  return h(
    element.type,
    element.attrs,
    element.children
      .filter((child) => child.type !== INNER_THOUGHT && child.type !== SEPARATOR)
      .map(strip),
  );
}

function restore(element: Element, nonce: string, captured: string[]): Element {
  if (element.type === "text") {
    return h.text(expand(`${element.attrs["content"] ?? ""}`, nonce, captured));
  }
  const attrs = Object.fromEntries(
    Object.entries(element.attrs).map(([key, value]) => [
      key,
      typeof value === "string" ? expand(value, nonce, captured) : value,
    ]),
  );
  return h(
    element.type,
    attrs,
    element.children.map((child) => restore(child, nonce, captured)),
  );
}

function expand(value: string, nonce: string, captured: string[]): string {
  let expanded = "";
  let cursor = 0;
  for (;;) {
    const start = value.indexOf(nonce, cursor);
    if (start < 0) return expanded + value.slice(cursor);
    const end = value.indexOf(MARK, start + nonce.length);
    if (end < 0) return expanded + value.slice(cursor);
    expanded +=
      value.slice(cursor, start) + (captured[Number(value.slice(start + nonce.length, end))] ?? "");
    cursor = end + 1;
  }
}

function isBlank(segment: readonly Element[]): boolean {
  return segment.every(
    (element) => element.type === "text" && `${element.attrs["content"] ?? ""}`.trim().length === 0,
  );
}
