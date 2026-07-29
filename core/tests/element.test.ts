import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { FORWARD_SUMMARY, normalizeElements } from "../src/event/element.js";

describe("non-image ingress elements", () => {
  it("normalizes quotes to their id only", () => {
    const [quote] = normalizeElements([h("quote", { id: "q-1", content: "discard" })]);
    expect(quote).toEqual(h("quote", { id: "q-1" }));
  });

  it("keeps the fixed forward summary", () => {
    const [forward] = normalizeElements([h("message", { forward: true, id: "f-1" })]);
    expect(forward).toEqual(h("forward", { id: "f-1", summary: FORWARD_SUMMARY }));
  });
});
