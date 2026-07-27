import { h, type Element } from "koishi";

export const FORWARD_SUMMARY = "[合并转发] 使用 onebot_get_forward_message 查看详情";

export function normalizeElements(elements: readonly Element[]): Element[] {
  const output: Element[] = [];
  for (const element of elements) {
    const normalized = normalizeElement(element);
    if (normalized === undefined) continue;
    output.push(...(Array.isArray(normalized) ? normalized : [normalized]));
  }
  return output;
}

export function sealElement(element: Element): Element {
  if (element.type === "img" && element.attrs.src) {
    return unavailableImage();
  }
  if (!element.children.length) return element;
  return h(element.type, element.attrs, sealElements(element.children));
}

export function sealElements(elements: readonly Element[]): Element[] {
  return normalizeElements(elements).map(sealElement);
}

export function isAssetImage(element: Element): boolean {
  return (
    element.type === "img" &&
    typeof element.attrs.id === "string" &&
    element.attrs.id.startsWith("asset_") &&
    typeof element.attrs.mime === "string"
  );
}

export function isUnavailableImage(element: Element): boolean {
  return element.type === "img" && isTrue(element.attrs.unavailable);
}

export function unavailableImage(): Element {
  return h("img", { unavailable: "true" });
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === "";
}

function normalizeElement(element: Element): Element | Element[] | undefined {
  const { type, attrs, children } = element;
  if (type === "text") return h.text(stringValue(attrs.content) ?? "");
  if (type === "br") return h("br");
  if (type === "p") return h("p", {}, normalizeElements(children));
  if (type === "at") {
    const id = stringValue(attrs.id) ?? "";
    const name = stringValue(attrs.name);
    return h("at", { id, ...(name ? { name } : {}) });
  }
  if (type === "face" || type === "emoji") {
    const id = stringValue(attrs.id);
    const name = stringValue(attrs.name);
    return h(type, { ...(id ? { id } : {}), ...(name ? { name } : {}) });
  }
  if (type === "img" || type === "image") {
    const id = stringValue(attrs.id);
    const mime = stringValue(attrs.mime);
    if (id?.startsWith("asset_") && mime) return h("img", { id, mime });
    if (isTrue(attrs.unavailable)) return unavailableImage();
    const src = stringValue(attrs.src);
    return src ? h("img", { src }) : unavailableImage();
  }
  if (type === "audio" || type === "video" || type === "file") {
    const title = stringValue(attrs.title) ?? stringValue(attrs.name);
    return h(type, { omitted: "true", ...(title ? { title } : {}) });
  }
  if (type === "quote") return h("quote", { id: stringValue(attrs.id) ?? "" });
  if (type === "forward") {
    return h("forward", {
      id: stringValue(attrs.id) ?? "",
      summary: stringValue(attrs.summary) ?? FORWARD_SUMMARY,
    });
  }
  if (type === "message" && isTrue(attrs.forward)) {
    return h("forward", { id: stringValue(attrs.id) ?? "", summary: FORWARD_SUMMARY });
  }
  return children.length ? normalizeElements(children) : undefined;
}

export function renderElements(elements: readonly Element[]): string {
  return elements.map((element) => hydrateElement(element).toString()).join("");
}

function hydrateElement(element: Element): Element {
  if (typeof element.toString === "function" && element.toString !== Object.prototype.toString) {
    return element;
  }
  return h(element.type, element.attrs, element.children.map(hydrateElement));
}
