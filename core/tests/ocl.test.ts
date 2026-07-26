import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { DEFAULT_REPLY_PACING_CONFIG, DEFAULT_REPLY_SEGMENTATION_CONFIG } from "../src/config.js";
import { parseReply } from "../src/reply/parse.js";

describe("reply parsing", () => {
  it("produces one visible segment without a control element", () => {
    expect(parseReply("hello", 8)).toEqual({ segments: [{ text: "hello" }] });
  });

  it("splits visible text at explicit separators", () => {
    expect(parseReply("one<sep/>two<sep/>three", 8).segments).toEqual([
      { text: "one" },
      { text: "two" },
      { text: "three" },
    ]);
  });

  it("removes private inner thought before planning visible delivery", () => {
    expect(parseReply("<inner_thought>private</inner_thought>visible", 8)).toMatchObject({
      innerThought: "private",
      segments: [{ text: "visible" }],
    });
  });

  it("unescapes literal control text without interpreting it", () => {
    expect(parseReply("&lt;sep/&gt;", 8).segments).toEqual([{ text: "<sep/>" }]);
  });

  it("drops empty leading, trailing, and consecutive separator segments", () => {
    expect(parseReply("<sep/> one <sep/><sep/> two <sep/>", 8).segments).toEqual([
      { text: "one" },
      { text: "two" },
    ]);
  });

  it("leaves unrecognized elements visible", () => {
    expect(parseReply("before<sleep ms=\"10\"/>after", 8).segments).toEqual([
      { text: 'before<sleep ms="10"/>after' },
    ]);
  });

  it("bounds marked segments without merging them", () => {
    expect(parseReply("one<sep/>two<sep/>three", 2)).toEqual({
      segments: [{ text: "one" }, { text: "two" }],
      degraded: "segment_limit_exceeded",
    });
  });

  it("degrades malformed recognized controls to one sanitized visible segment", () => {
    expect(parseReply("before<inner_thought>private", 8)).toEqual({
      segments: [{ text: "before" }],
      degraded: "residual_control_element",
    });
  });
});

describe("reply defaults", () => {
  it("defines bounded segmentation and pacing defaults", () => {
    expect(DEFAULT_REPLY_SEGMENTATION_CONFIG.maxSegments).toBeGreaterThan(0);
    expect(DEFAULT_REPLY_PACING_CONFIG.maxSegmentDelayMs).toBeGreaterThan(
      DEFAULT_REPLY_PACING_CONFIG.minDelayMs,
    );
  });
});
