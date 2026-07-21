import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { elementsToLiteral, sealMessage, formatMessageHeader } from "../src/platform/message.js";
import { FORWARD_SUMMARY, normalizeElements } from "../src/platform/utils/elements.js";

describe("element normalization", () => {
  it("unwraps unknown wrappers and keeps at", () => {
    const input = h.parse('<x token="secret">hi <at id="42"/></x>');
    const out = normalizeElements(input);
    expect(elementsToLiteral(out)).toBe('hi <at id="42"/>');
  });

  it("collapses forward message trees to shallow forward", () => {
    const input = h.parse('<message id="f1" forward><message id="c"/></message>');
    const out = normalizeElements(input);
    const lit = elementsToLiteral(out);
    expect(lit).toContain("<forward");
    expect(lit).toContain('id="f1"');
    expect(lit).toContain(FORWARD_SUMMARY);
    expect(lit).not.toContain("<message");
  });

  it("keeps quote id only", () => {
    const out = normalizeElements(h.parse('<quote id="q1">body</quote>'));
    expect(elementsToLiteral(out)).toBe('<quote id="q1"/>');
  });

  it("marks non-image media omitted without urls", () => {
    const out = normalizeElements(h.parse('<audio src="https://x" title="v"/>'));
    const lit = elementsToLiteral(out);
    expect(lit).toContain('omitted="true"');
    expect(lit).not.toContain("https://");
  });

  it("retains text, br, p, at, face, emoji", () => {
    const input = h.parse('hello<br/><p>para</p><at id="1" name="A"/><face id="2"/>');
    const out = normalizeElements(input);
    const lit = elementsToLiteral(out);
    expect(lit).toContain("hello");
    expect(lit).toContain("<br/>");
    expect(lit).toContain("<p>para</p>");
    expect(lit).toContain('<at id="1" name="A"/>');
    expect(lit).toContain('<face id="2"/>');
  });

  it("keeps remote img src in draft (seal will strip)", () => {
    const out = normalizeElements(h.parse('<img src="https://a/b.png"/>'));
    const lit = elementsToLiteral(out);
    expect(lit).toContain('src="https://a/b.png"');
  });

  it("sealMessage rewrites remote img to unavailable", () => {
    const message = {
      source: { platform: "t", selfId: "b" },
      scope: { type: "channel" as const, channelId: "c", channelType: "group" as const },
      sender: { id: "u" },
      messageId: "m",
      receivedAt: 1,
      elements: h.parse('<img src="https://a/b.png"/>'),
    };
    const sealed = sealMessage(message);
    const lit = elementsToLiteral(sealed.elements);
    expect(lit).not.toContain("https://");
    expect(lit).toContain('unavailable="true"');
  });

  it("seals nested remote images without dropping surrounding text", () => {
    const message = {
      source: { platform: "t", selfId: "b" },
      scope: { type: "channel" as const, channelId: "c", channelType: "group" as const },
      sender: { id: "u" },
      messageId: "m",
      receivedAt: 1,
      elements: [
        h("p", {}, [h.text("before"), h("img", { src: "https://example/a.png" }), h.text("after")]),
      ],
    };

    const literal = elementsToLiteral(sealMessage(message).elements);

    expect(literal).toContain("before");
    expect(literal).toContain("after");
    expect(literal).toContain('unavailable="true"');
    expect(literal).not.toContain("https://");
  });

  it("preserves asset images through seal", () => {
    const message = {
      source: { platform: "t", selfId: "b" },
      scope: { type: "channel" as const, channelId: "c", channelType: "group" as const },
      sender: { id: "u" },
      messageId: "m",
      receivedAt: 1,
      elements: h.parse('<img id="asset_abc" mime="image/png"/>'),
    };
    const sealed = sealMessage(message);
    const lit = elementsToLiteral(sealed.elements);
    expect(lit).toContain('id="asset_abc"');
    expect(lit).toContain('mime="image/png"');
  });
});

describe("message header formatting", () => {
  it("formats fixed header with escaped values (with id)", () => {
    const header = formatMessageHeader(
      {
        sender: { id: "u1", name: "Alice" },
        messageId: "m1",
        timestamp: Date.parse("2026-07-18T12:34:00+08:00"),
        receivedAt: Date.parse("2026-07-18T12:34:00+08:00"),
      },
      { includeMessageId: true },
    );
    // Check field order and content
    expect(header).toMatch(/^\[time="[^"]*" id="m1" sender="[^"]*"\]$/);
  });

  it("formats header without id when not required", () => {
    const header = formatMessageHeader(
      {
        sender: { id: "u1" },
        messageId: "m1",
        timestamp: 0,
        receivedAt: 0,
      },
      { includeMessageId: false },
    );
    expect(header).not.toContain("id=");
    expect(header).toMatch(/^\[time="[^"]*" sender="[^"]*"\]$/);
  });

  it("uses raw id when display name is absent", () => {
    const header = formatMessageHeader(
      {
        sender: { id: "u1" },
        messageId: "m1",
        timestamp: 0,
        receivedAt: 0,
      },
      { includeMessageId: false },
    );
    expect(header).toContain('"u1"');
  });

  it("escapes special characters in field values", () => {
    const header = formatMessageHeader(
      {
        sender: { id: "u1", name: 'A"B' },
        messageId: "m1",
        timestamp: 0,
        receivedAt: 0,
      },
      { includeMessageId: true },
    );
    // JSON.stringify escapes the double-quote within the name
    expect(header).toContain('A\\"B');
  });
});
