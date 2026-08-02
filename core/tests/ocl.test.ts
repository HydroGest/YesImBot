import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Element } from "koishi";

import { parseReply } from "../src/runtime/reply.js";

function text(segment: readonly Element[]): string {
  return segment
    .map((element) => (element.type === "text" ? `${element.attrs["content"] ?? ""}` : element.toString()))
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

describe("parseReply newline fallback", () => {
  it("splits plain paragraphs on blank lines when newlineFallback is enabled", () => {
    const segments = parseReply("First paragraph.\n\nSecond paragraph.", { newlineFallback: true });
    expect(segments.map(text)).toEqual(["First paragraph.", "Second paragraph."]);
  });

  it("keeps blank-line text as one segment when newlineFallback is disabled or omitted", () => {
    expect(parseReply("First paragraph.\n\nSecond paragraph.", { newlineFallback: false }).map(text)).toEqual([
      "First paragraph.\n\nSecond paragraph.",
    ]);
    expect(parseReply("First paragraph.\n\nSecond paragraph.").map(text)).toEqual([
      "First paragraph.\n\nSecond paragraph.",
    ]);
  });

  it("treats explicit <sep/> as authoritative and skips the fallback", () => {
    const segments = parseReply("a\n\nb<sep/>c", { newlineFallback: true });
    expect(segments.map(text)).toEqual(["a\n\nb", "c"]);
  });

  it("does not split on single newlines", () => {
    const segments = parseReply("line one\nline two", { newlineFallback: true });
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("line one\nline two");
  });

  it("does not split fenced code, inline code, URLs, or quoted text", () => {
    const fenced = parseReply("intro\n\n```ts\nconst a: number = 1;\n```\n\noutro", { newlineFallback: true });
    expect(fenced).toHaveLength(1);
    const inline = parseReply("use `x`\n\nthen y", { newlineFallback: true });
    expect(inline).toHaveLength(1);
    const url = parseReply("see https://example.com\n\nmore", { newlineFallback: true });
    expect(url).toHaveLength(1);
    const quoted = parseReply("> quote\n\nnext", { newlineFallback: true });
    expect(quoted).toHaveLength(1);
  });

  it("does not split inside <raw> or structured Koishi elements", () => {
    const raw = parseReply("<raw>a\n\nb</raw>", { newlineFallback: true });
    expect(raw).toHaveLength(1);
    expect(text(raw[0])).toBe("a\n\nb");
    const structured = parseReply('before\n\n<at id="42"/>\n\nafter', { newlineFallback: true });
    expect(structured).toHaveLength(1);
    const at = structured[0].find((element) => element.type === "at");
    expect(at).toBeDefined();
    expect(at?.attrs["id"]).toBe("42");
  });

  it("does not apply the fallback when any <raw> content is present", () => {
    const fenced = parseReply("<raw>```ts\nconst x = 1;\n```</raw>\n\nmore", { newlineFallback: true });
    expect(fenced).toHaveLength(1);
    expect(text(fenced[0])).toBe("```ts\nconst x = 1;\n```\n\nmore");
    const plain = parseReply("<raw>a\n\nb</raw>\n\nnext", { newlineFallback: true });
    expect(plain).toHaveLength(1);
    expect(text(plain[0])).toBe("a\n\nb\n\nnext");
  });

  it("recognizes CRLF blank lines as paragraph breaks", () => {
    const segments = parseReply("First\r\n\r\nSecond", { newlineFallback: true });
    expect(segments.map(text)).toEqual(["First", "Second"]);
  });

  it("does not split prose containing scheme-less URLs or markdown links", () => {
    const bare = parseReply("see www.example.com\n\nmore", { newlineFallback: true });
    expect(bare).toHaveLength(1);
    expect(text(bare[0])).toBe("see www.example.com\n\nmore");
    const markdown = parseReply("see [docs](www.example.com)\n\nmore", { newlineFallback: true });
    expect(markdown).toHaveLength(1);
    expect(text(markdown[0])).toBe("see [docs](www.example.com)\n\nmore");
  });
});
