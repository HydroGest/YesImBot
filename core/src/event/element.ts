import { h, type Element } from "koishi";

export const FORWARD_SUMMARY = "[合并转发] 使用 onebot_get_forward_message 查看详情";


export function renderElements(elements: readonly Element[]): string {
  return elements.map((element) => hydrateElement(element).toString()).join("");
}

function hydrateElement(element: Element): Element {
  if (typeof element.toString === "function" && element.toString !== Object.prototype.toString) {
    return element;
  }
  return h(element.type, element.attrs, element.children.map(hydrateElement));
}
