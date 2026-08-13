import type { Element } from "koishi";
import { h } from "koishi";

const text = `欢迎 <at id="{userId}"/> 入群！<image id="{userId}" src="1234"/>`;

const elements = h.parse(text);

function warp(element: Element, onecode: string) {
    element.attrs.onetime_code = onecode;
    return element;
}

const transformation = h.transform(elements, (element) => {
    if (element.type === "text") {
        return h.escape(element.attrs.content);
    }
    return warp(element, "123456");
});

// console.log(elements);

console.log(transformation);
console.log(transformation.join(""));
