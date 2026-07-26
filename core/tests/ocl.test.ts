import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import {
  findControlElements,
  findProtectionZones,
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
