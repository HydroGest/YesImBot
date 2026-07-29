import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { FORWARD_SUMMARY, renderElements } from "../src/event/element.js";

describe("non-image ingress elements", () => {
  it("preserves quote structure", () => {
    expect(renderElements([h("quote", { id: "q-1" })])).toBe('<quote id="q-1"/>');
  });

  it("preserves the fixed forward summary", () => {
    expect(renderElements([h("forward", { id: "f-1", summary: FORWARD_SUMMARY })])).toBe(
      `<forward id="f-1" summary="${FORWARD_SUMMARY}"/>`,
    );
  });
});
