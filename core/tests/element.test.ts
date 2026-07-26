import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import {
  FORWARD_SUMMARY,
  isAssetImage,
  isUnavailableImage,
  normalizeElements,
  sealElements,
} from "../src/event/element.js";

describe("sealed elements", () => {
  it("seals image, quote, and forward elements without changing literals", () => {
    const elements = sealElements([
      h("img", { src: "https://example.invalid/a.png" }),
      h("quote", { id: "q-1" }),
      h("forward", { id: "f-1" }),
    ]);

    expect(elements.map((element) => element.toString())).toEqual([
      '<img unavailable="true"/>',
      '<quote id="q-1"/>',
      `<forward id="f-1" summary="${FORWARD_SUMMARY}"/>`,
    ]);
  });

  it("keeps the fixed summary for legacy forward messages", () => {
    const [forward] = sealElements([h("message", { forward: true, id: "f-2" })]);

    expect(forward?.toString()).toBe(`<forward id="f-2" summary="${FORWARD_SUMMARY}"/>`);
  });

  it("recognizes private and permanently unavailable images", () => {
    const [asset, unavailable] = normalizeElements([
      h("img", { id: "asset_abc", mime: "image/png" }),
      h("img", { unavailable: "true" }),
    ]);

    expect(isAssetImage(asset!)).toBe(true);
    expect(isUnavailableImage(asset!)).toBe(false);
    expect(isUnavailableImage(unavailable!)).toBe(true);
    expect(isAssetImage(unavailable!)).toBe(false);
  });
});
