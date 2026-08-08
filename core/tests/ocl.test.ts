import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { Element, h } from "koishi";

import { parseReply } from "../src/runtimes/output.js";

function text(segment: readonly Element[]): string {
  return segment.map((element) => (element.type === "text" ? `${element.attrs["content"] ?? ""}` : element.toString())).join("");
}

describe("parseReply", () => {
  it("produces one fragment for plain text", () => {
    const segments = parseReply("hello world");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("hello world");
  });

  it("splits message elements into separate delivery segments", () => {
    const segments = parseReply("one<message>two</message>three");
    expect(segments.map(text)).toEqual(["one", "two", "three"]);
  });

  it("splits nested message elements into separate delivery segments", () => {
    const segments = parseReply("one<message>two<message>three</message></message>four");
    expect(segments.map(text)).toEqual(["one", "two", "three", "four"]);
  });

  it("preserves platform elements at the reply root", () => {
    const segments = parseReply('hello <at id="42"/> there');
    expect(segments).toHaveLength(1);
    expect(segments[0].find((element) => element.type === "at")?.attrs["id"]).toBe("42");
  });

  it("keeps at and quote elements inside the same message segment", () => {
    const segments = parseReply('hello <at id="42"/> <quote>quoted</quote> world');
    expect(segments).toHaveLength(1);
    expect(segments[0].some((element) => element.type === "at")).toBe(true);
    expect(segments[0].some((element) => element.type === "quote")).toBe(true);
  });

  it("preserves unrecognized Koishi elements without a Core allowlist", () => {
    const segments = parseReply('<custom-card state="open"/>');
    expect(segments).toHaveLength(1);
    expect(segments[0][0].type).toBe("custom-card");
    expect(segments[0][0].attrs["state"]).toBe("open");
  });

  it("delivers <text> content literally with no nested elements", () => {
    const segments = parseReply("<text>List<String> generic</text>");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0][0].type).toBe("text");
    expect(text(segments[0])).toBe("List<String> generic");
  });

  it("does not parse a message element inside <text>", () => {
    const segments = parseReply("<text>before<message>after</message></text>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<message>after</message>");
  });

  it("keeps escaped element syntax as literal text", () => {
    const segments = parseReply("before&lt;message&gt;after&lt;/message&gt;");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("before<message>after</message>");
  });

  it("fully removes root inner thought from the output", () => {
    const segments = parseReply("<inner_thought>private plan</inner_thought>visible reply");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible reply");
  });

  it("fully removes inner thought nested in a message element", () => {
    const segments = parseReply("<message>visible<inner_thought>private</inner_thought></message>");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("visible");
  });

  it("does not create empty segments around message boundaries", () => {
    expect(parseReply("one<message/>two")).toEqual([[h.text("one")], [h.text("two")]]);
  });

  it("does not trigger substitution for text resembling the nonce placeholder", () => {
    const segments = parseReply("\u0000r0\u0000 not a real capture");
    expect(segments).toHaveLength(1);
    expect(text(segments[0])).toBe("r0 not a real capture");
  });
});
