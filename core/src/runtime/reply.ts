import { Element, h } from "koishi";

const TEXT_OPEN = "<text>";
const TEXT_CLOSE = "</text>";
const INNER_THOUGHT = "inner_thought";
const MESSAGE = "message";
const MARK = "\u0000";

interface TextCapture {
  readonly content: string;
}

export function parseReply(raw: string): Element[][] {
  const source = raw.replaceAll(MARK, "");
  const nonce = `${MARK}t${Math.random().toString(36).slice(2)}`;
  const captured: TextCapture[] = [];
  const tree = h.parse(maskText(source, nonce, captured));
  const visible = tree.flatMap((element) => removeInnerThought(element));
  return splitMessageElements(restoreText(visible, nonce, captured)).filter((segment) => !isBlank(segment));
}

function maskText(source: string, nonce: string, captured: TextCapture[]): string {
  let masked = "";
  let cursor = 0;
  for (;;) {
    const open = source.indexOf(TEXT_OPEN, cursor);
    if (open < 0) return masked + source.slice(cursor);
    masked += source.slice(cursor, open);
    const start = open + TEXT_OPEN.length;
    const close = source.indexOf(TEXT_CLOSE, start);
    masked += `${nonce}${captured.length}${MARK}`;
    captured.push({ content: close < 0 ? source.slice(start) : source.slice(start, close) });
    if (close < 0) return masked;
    cursor = close + TEXT_CLOSE.length;
  }
}

function removeInnerThought(element: Element): Element[] {
  if (element.type === INNER_THOUGHT) return [];
  if (element.children.length === 0) return [element];
  return [h(element.type, element.attrs, element.children.flatMap(removeInnerThought))];
}

function restoreText(elements: readonly Element[], nonce: string, captured: readonly TextCapture[]): Element[] {
  return elements.flatMap((element) => {
    if (element.type !== "text") {
      return [h(element.type, element.attrs, restoreText(element.children, nonce, captured))];
    }
    const content = `${element.attrs["content"] ?? ""}`;
    const restored: Element[] = [];
    let cursor = 0;
    for (;;) {
      const start = content.indexOf(nonce, cursor);
      if (start < 0) {
        if (cursor < content.length) restored.push(h.text(content.slice(cursor)));
        return restored;
      }
      const end = content.indexOf(MARK, start + nonce.length);
      if (end < 0) return [h.text(content)];
      if (cursor < start) restored.push(h.text(content.slice(cursor, start)));
      const capture = captured[Number(content.slice(start + nonce.length, end))];
      if (capture !== undefined && capture.content.length > 0) restored.push(h.text(capture.content));
      cursor = end + 1;
    }
  });
}

function splitMessageElements(elements: readonly Element[]): Element[][] {
  const segments: Element[][] = [];
  let current: Element[] = [];
  const flush = (): void => {
    if (!isBlank(current)) segments.push(current);
    current = [];
  };

  for (const element of elements) {
    if (element.type === MESSAGE) {
      flush();
      if (element.children.length > 0) {
        segments.push(...splitMessageElements(element.children));
      }
      continue;
    }
    current.push(element);
  }
  flush();
  return segments;
}

function isBlank(segment: readonly Element[]): boolean {
  return segment.every((element) => element.type === "text" && `${element.attrs["content"] ?? ""}`.trim().length === 0);
}
