import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Element } from "koishi";

import { parseReply } from "../src/runtime/reply.js";

function text(segment: readonly Element[]): string {
  return segment
    .map((element) =>
      element.type === "text" ? `${element.attrs["content"] ?? ""}` : element.toString(),
    )
    .join("");
}

describe("parseReply", () => {
  it("produces one segment for plain text without control elements", () => {
    const segments = parseReply("hello world");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("hello world");
  });

  it("splits text into ordered segments at <sep/>", () => {
    const segments = parseReply("one<sep/>two<sep/>three");
    expect(segments.map(text)).toEqual(["one", "two", "three"]);
  });

  it("produces no empty segment for leading, trailing, and consecutive separators", () => {
    const segments = parseReply("<sep/>one<sep/><sep/>two<sep/>");
    expect(segments.map(text)).toEqual(["one", "two"]);
  });

  it("fully removes <inner_thought> from the output", () => {
    const segments = parseReply("<inner_thought>private plan</inner_thought>visible reply");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible reply");
    for (const segment of segments) {
      for (const element of segment) {
        expect(element.type).not.toBe("inner_thought");
      }
    }
  });

  it("delivers <raw> content literally with no nested elements", () => {
    const segments = parseReply("<raw>List<String> generic</raw>");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0][0].type).toBe("text");
    expect(text(segments[0])).toBe("List<String> generic");
    const serialized = segments[0].map((element) => element.toString()).join("");
    expect(serialized).not.toContain("<string");
  });

  it("preserves a code fence with multiple angle brackets inside <raw>", () => {
    const code = "```ts\nconst x: Array<Array<number>> = [];\n```";
    const segments = parseReply(`<raw>${code}</raw>`);
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe(code);
  });

  it("does not split on <sep/> that appears inside <raw>", () => {
    const segments = parseReply("<raw>before<sep/>after</raw>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<sep/>after");
  });

  it("does not drop content when <raw> is unterminated", () => {
    const segments = parseReply("<raw>unterminated content stays intact");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("unterminated content stays intact");
  });

  it("does not trigger substitution for text resembling the nonce placeholder", () => {
    const segments = parseReply("\u0000r0\u0000 not a real capture");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("r0 not a real capture");
  });

  it('keeps <at id="42"/> as an element that survives parsing', () => {
    const segments = parseReply('hello <at id="42"/> there');
    expect(segments).toHaveLength(1);
    const at = segments[0].find((element) => element.type === "at");
    expect(at).toBeDefined();
    expect(at?.attrs["id"]).toBe("42");
  });

  it("delivers entity-form &lt;sep/&gt; as literal text without splitting", () => {
    const segments = parseReply("before&lt;sep/&gt;after");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<sep/>after");
  });

  it("passes an unknown element type through structurally without warning", () => {
    const segments = parseReply('before<sleep ms="10"/>after');
    expect(segments).toHaveLength(1);
    const sleep = segments[0].find((element) => element.type === "sleep");
    expect(sleep).toBeDefined();
    expect(sleep?.attrs["ms"]).toBe("10");
  });
});
