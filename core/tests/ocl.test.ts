import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import {
  findControlElements,
  findProtectionZones,
  parseReply,
  unescapeControlEntities,
} from "../src/reply/ocl.js";
import { DEFAULT_REPLY_PACING_CONFIG, DEFAULT_REPLY_SEGMENTATION_CONFIG } from "../src/config.js";

describe("OCL protection zones", () => {
  it("preserves language-tagged and unterminated fenced blocks as original ranges", () => {
    const fenced = "before\n```ts\nconst marker = '<sep/>'\n```\nafter";
    const unterminated = "before\n```ts\nconst marker = '<sep/>'";

    expect(findProtectionZones(fenced).map((range) => fenced.slice(range.start, range.end))).toEqual([
      "```ts\nconst marker = '<sep/>'\n```",
    ]);
    expect(findProtectionZones(unterminated).map((range) => unterminated.slice(range.start, range.end))).toEqual([
      "```ts\nconst marker = '<sep/>'",
    ]);
  });

  it("preserves nested and doubled inline backticks", () => {
    const raw = "`outer <sep/>` and ``nested ` <skip/> ` content``";

    expect(findProtectionZones(raw).map((range) => raw.slice(range.start, range.end))).toEqual([
      "`outer <sep/>`",
      "``nested ` <skip/> ` content``",
    ]);
  });

  it("keeps adjacent URLs and platform elements in separate original ranges", () => {
    const raw = "https://example.invalid/path?<sep/>=<skip/><at id=\"user\"/><img src=\"x\"/><quote id=\"q\"><sep/></quote>";

    expect(findProtectionZones(raw).map((range) => raw.slice(range.start, range.end))).toEqual([
      "https://example.invalid/path?<sep/>=<skip/>",
      '<at id="user"/>',
      '<img src="x"/>',
      '<quote id="q"><sep/></quote>',
    ]);
  });

  it("preserves arbitrary non-control platform elements with balanced and unclosed bodies", () => {
    const balanced = '<message id="outer"><message id="inner"><sep/></message><skip/></message><face id="smile"/>';
    const unclosed = '<message id="partial"><sep/>';

    expect(findProtectionZones(balanced).map((range) => balanced.slice(range.start, range.end))).toEqual([
      '<message id="outer"><message id="inner"><sep/></message><skip/></message>',
      '<face id="smile"/>',
    ]);
    expect(findControlElements(balanced, findProtectionZones(balanced))).toEqual([]);
    expect(findProtectionZones(unclosed).map((range) => unclosed.slice(range.start, range.end))).toEqual([unclosed]);
    expect(findControlElements(unclosed, findProtectionZones(unclosed))).toEqual([]);
  });
});

describe("OCL control elements", () => {
  it("recognizes exactly the four host controls outside protection zones", () => {
    const raw = '<inner_thought>plan</inner_thought><sep/><sleep ms="250"/><skip/><plugin_control/><sleep/><sleep ms="bad"/>';

    expect(
      findControlElements(raw, findProtectionZones(raw)).map(({ type, raw: element }) => ({ type, raw: element })),
    ).toEqual([
      { type: "inner_thought", raw: "<inner_thought>plan</inner_thought>" },
      { type: "sep", raw: "<sep/>" },
      { type: "sleep", raw: '<sleep ms="250"/>' },
      { type: "skip", raw: "<skip/>" },
    ]);
  });

  it("leaves unrecognized look-alikes visible and controls inside zones literal", () => {
    const raw = "<separator/> <sep></sep> `<skip/>` <at id=\"u\"><sep/></at>";

    expect(findControlElements(raw, findProtectionZones(raw))).toEqual([]);
  });

  it("unescapes only escaped control elements without rewriting unrelated entities", () => {
    const raw = "&lt;sep/&gt; &lt;sleep ms=&quot;250&quot;/&gt; &lt;skip/&gt; &lt;inner_thought&gt;note&lt;/inner_thought&gt; &amp; &apos; &quot; &lt;tag&gt;";

    expect(findControlElements(raw, findProtectionZones(raw))).toEqual([]);
    expect(unescapeControlEntities(raw)).toBe(
      '<sep/> <sleep ms="250"/> <skip/> <inner_thought>note</inner_thought> &amp; &apos; &quot; &lt;tag&gt;',
    );
  });
});

describe("OCL reply parsing", () => {
  const limits = { maxSegments: 3 };

  it("extracts inner thoughts before splitting and sums sleep hints within each visible segment", () => {
    const parsed = parseReply(
      '<inner_thought>private plan</inner_thought> first <sleep ms="120"/><sep/> second <sleep ms="80"/><sleep ms="20"/>',
      limits,
    );

    expect(parsed).toEqual({
      innerThoughts: ["private plan"],
      skipped: false,
      segments: [
        { text: "first", sleepHintMs: 120, index: 1, total: 2 },
        { text: "second", sleepHintMs: 100, index: 2, total: 2 },
      ],
    });
  });

  it("preserves surrounding whitespace semantics while removing an inner thought", () => {
    const parsed = parseReply("before <inner_thought>private</inner_thought> after", limits);

    expect(parsed.segments).toEqual([{ text: "before  after", sleepHintMs: 0, index: 1, total: 1 }]);
  });

  it("skips visible delivery after extracting inner thoughts", () => {
    const parsed = parseReply('<inner_thought>decline</inner_thought>visible<skip/>content', limits);

    expect(parsed).toEqual({ innerThoughts: ["decline"], skipped: true, segments: [] });
  });

  it("keeps protected and escaped controls literal while normalizing marked separators", () => {
    const parsed = parseReply(
      ' <sep/> first <sep/><sep/> `literal <sep/>` <sep/> https://example.invalid/?x=<sep/> &lt;sep/&gt; <sep/> ',
      limits,
    );

    expect(parsed.segments).toEqual([
      { text: "first", sleepHintMs: 0, index: 1, total: 3 },
      { text: "`literal <sep/>`", sleepHintMs: 0, index: 2, total: 3 },
      {
        text: "https://example.invalid/?x=<sep/> <sep/>",
        sleepHintMs: 0,
        index: 3,
        total: 3,
      },
    ]);
  });

  it("is deterministic and never adds semantic split points", () => {
    const raw = "One sentence. Another sentence! No model separator here?";

    expect(parseReply(raw, limits)).toEqual(parseReply(raw, limits));
    expect(parseReply(raw, limits).segments).toEqual([
      { text: raw, sleepHintMs: 0, index: 1, total: 1 },
    ]);
  });

  it("merges excess segments at the configured maximum without losing text or sleep hints", () => {
    const parsed = parseReply(
      'one<sleep ms="10"/><sep/>two<sleep ms="20"/><sep/>three<sleep ms="30"/><sep/>four<sleep ms="40"/>',
      { maxSegments: 3 },
    );

    expect(parsed).toEqual({
      innerThoughts: [],
      skipped: false,
      degraded: "segment_limit_exceeded",
      segments: [
        { text: "one", sleepHintMs: 10, index: 1, total: 3 },
        { text: "two", sleepHintMs: 20, index: 2, total: 3 },
        { text: "threefour", sleepHintMs: 70, index: 3, total: 3 },
      ],
    });
  });

  it("degrades an empty normalized reply to one sanitized segment", () => {
    const parsed = parseReply(" <sep/> <sleep ms=\"20\"/> ", limits);

    expect(parsed).toEqual({
      innerThoughts: [],
      skipped: false,
      degraded: "no_segments",
      segments: [{ text: "", sleepHintMs: 0, index: 1, total: 1 }],
    });
  });

  it("degrades reconstructed residual controls without leaking the control element", () => {
    const parsed = parseReply("before<<inner_thought>private</inner_thought>sep/>after", limits);

    expect(parsed).toEqual({
      innerThoughts: ["private"],
      skipped: false,
      degraded: "residual_control_element",
      segments: [{ text: "beforeafter", sleepHintMs: 0, index: 1, total: 1 }],
    });
  });

  it("degrades parse failures to sanitized visible text", () => {
    const malformed = { toString: () => "visible<sep/>text" } as unknown as string;

    expect(parseReply(malformed, limits)).toEqual({
      innerThoughts: [],
      skipped: false,
      degraded: "parse_failed",
      segments: [{ text: "visibletext", sleepHintMs: 0, index: 1, total: 1 }],
    });
  });
});

describe("reply defaults", () => {
  it("defines bounded segmentation and pacing defaults", () => {
    expect(DEFAULT_REPLY_SEGMENTATION_CONFIG.maxSegments).toBeGreaterThan(0);
    expect(DEFAULT_REPLY_PACING_CONFIG.maxSegmentDelayMs).toBeGreaterThan(
      DEFAULT_REPLY_PACING_CONFIG.minDelayMs,
    );
    expect(DEFAULT_REPLY_PACING_CONFIG.maxTotalDelayMs).toBeGreaterThan(
      DEFAULT_REPLY_PACING_CONFIG.maxSegmentDelayMs,
    );
    expect(DEFAULT_REPLY_PACING_CONFIG.cjkCharactersPerSecond).toBeGreaterThan(0);
    expect(DEFAULT_REPLY_PACING_CONFIG.latinCharactersPerSecond).toBeGreaterThan(0);
    expect(DEFAULT_REPLY_PACING_CONFIG.randomFactorMin).toBeLessThanOrEqual(
      DEFAULT_REPLY_PACING_CONFIG.randomFactorMax,
    );
    expect(DEFAULT_REPLY_PACING_CONFIG.firstSegmentResidualMinMs).toBeLessThanOrEqual(
      DEFAULT_REPLY_PACING_CONFIG.firstSegmentResidualMaxMs,
    );
  });
});
