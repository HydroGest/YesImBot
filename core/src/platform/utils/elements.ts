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

export function sealElements(elements: readonly Element[]): Element[] {
  return normalizeElements(elements).map((element) => {
    if (element.type === "img" && element.attrs.src) {
      return h("img", { unavailable: "true" });
    }
    if (!element.children.length) return element;
    return h(element.type, element.attrs, sealElements(element.children));
  });
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
    if (isTrue(attrs.unavailable)) return h("img", { unavailable: "true" });
    const src = stringValue(attrs.src);
    return src ? h("img", { src }) : h("img", { unavailable: "true" });
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
    return h("forward", {
      id: stringValue(attrs.id) ?? "",
      summary: FORWARD_SUMMARY,
    });
  }
  return children.length ? normalizeElements(children) : undefined;
}
