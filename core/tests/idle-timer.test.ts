import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));
import { h } from "koishi";

import { parseReply } from "../src/runtimes/output.js";

describe("reply output", () => {
  it("removes inner thought and splits structural message elements", () => {
    const segments = parseReply("<inner_thought>hidden</inner_thought><message>one</message><message>two</message>");
    expect(segments).toHaveLength(2);
    expect(segments.flat().map((element) => h(element.type, element.attrs, element.children).toString()).join("")).not.toContain("hidden");
  });
});
