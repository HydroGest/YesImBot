import type { AgentEntry, AgentMessage } from "@yesimbot/agent-runtime";
import { h, type Element } from "koishi";

const ASSET_ID = /^[a-f0-9]{32}$/;

export interface AnimatedImageProjectionOptions {
  readonly attachImageSummary?: boolean;
}

export function projectAnimatedImages(entries: readonly AgentEntry[], options: AnimatedImageProjectionOptions = {}): AgentEntry[] {
  const attachImageSummary = options.attachImageSummary ?? true;
  return entries.map((entry) => {
    if (entry.type !== "message") return entry;
    const data = getMessageData(entry.data);
    if (!data) return entry;
    const elements = data.elements.map((element) => projectElement(element, attachImageSummary));
    if (elements.length === data.elements.length && elements.every((element, index) => element === data.elements[index])) {
      return entry;
    }
    const message = entry.data as unknown as { data: { elements: readonly Element[] } };
    return { ...entry, data: { ...message, data: { ...message.data, elements } } } as unknown as AgentEntry;
  });
}

function getMessageData(message: AgentMessage): { elements: readonly Element[] } | undefined {
  if (message.role !== "custom" || message.type !== "yesimbot.message") return undefined;
  const data = (message as { data?: unknown }).data;
  return typeof data === "object" && data !== null && "elements" in data ? (data as { elements: readonly Element[] }) : undefined;
}

function projectElement(element: Element, attachImageSummary: boolean): Element {
  if (element.type === "img" && isAnimatedImageElement(element.attrs)) {
    return h("text", {
      content: formatAnimatedImageLabel({
        attachImageSummary,
        summary: element.attrs.summary,
        id: element.attrs.id,
      }),
    });
  }
  if (element.children.length === 0) return element;
  const children = element.children.map((child) => projectElement(child, attachImageSummary));
  if (children.every((child, index) => child === element.children[index])) return element;
  return h(element.type, element.attrs, children);
}

export function isAnimatedImage(data: { sub_type?: unknown; subType?: unknown }): boolean {
  return data.sub_type === 1 || data.sub_type === "1" || data.subType === 1 || data.subType === "1";
}

function isAnimatedImageElement(attrs: { summary?: unknown; sub_type?: unknown; subType?: unknown }): boolean {
  return isAnimatedImage(attrs) || (typeof attrs.summary === "string" && attrs.summary.trim().length > 0);
}

export function formatAnimatedImageLabel(options: { readonly attachImageSummary: boolean; readonly summary?: unknown; readonly id?: unknown }): string {
  const parts: string[] = [];
  if (options.attachImageSummary) {
    const summary = options.summary;
    if (typeof summary === "string" && summary.trim().length > 0) parts.push(summary.trim());
  }
  const id = options.id;
  if (typeof id === "string" && ASSET_ID.test(id)) parts.push(`asset://${id}`);
  return parts.length > 0 ? `[动画表情: ${parts.join(" ")}]` : "[动画表情]";
}
