import { describe, expect, it } from "vitest";

import { formatPreview, formatToon, isJsonLike, redactJsonLike } from "../src/format.js";

describe("tool observer formatting", () => {
  it("detects JSON-like structured values without treating plain text as structured", () => {
    expect(isJsonLike({ query: "koishi", limit: 3 })).toBe(true);
    expect(isJsonLike([{ title: "A" }, { title: "B" }])).toBe(true);
    expect(isJsonLike(["a", "b"])).toBe(true);
    expect(isJsonLike("plain text")).toBe(false);
    expect(isJsonLike(new Date())).toBe(false);
  });

  it("redacts configured keys recursively", () => {
    expect(
      redactJsonLike({ token: "abc", nested: { apiKey: "secret", keep: "ok" } }, [
        "token",
        "apiKey",
      ]),
    ).toEqual({ token: "[redacted]", nested: { apiKey: "[redacted]", keep: "ok" } });
  });

  it("formats objects as compact TOON", () => {
    expect(formatToon({ query: "koishi", limit: 3 })).toBe("query: koishi\nlimit: 3");
  });

  it("formats arrays as compact TOON", () => {
    expect(formatToon([{ title: "A" }, { title: "B" }])).toBe(
      "items[2]:\n  - title: A\n  - title: B",
    );
  });

  it("uses safe text previews for non-JSON-like values", () => {
    expect(formatPreview("plain text", { maxChars: 100, redactKeys: [] })).toBe("plain text");
  });

  it("redacts plain object previews before falling back from TOON", () => {
    const preview = formatPreview(
      { token: "secret", optional: undefined },
      { maxChars: 100, redactKeys: ["token"] },
    );

    expect(preview).toContain("[redacted]");
    expect(preview).not.toContain("secret");
  });

  it("does not serialize sensitive fields from class instances", () => {
    class Credential {
      token = "secret";
    }

    const preview = formatPreview(new Credential(), { maxChars: 100, redactKeys: ["token"] });

    expect(preview).toBe("[Credential]");
    expect(preview).not.toContain("secret");
  });

  it("does not execute toJSON hooks while formatting fallback previews", () => {
    const secret = "secret";
    const preview = formatPreview(
      {
        token: secret,
        optional: undefined,
        toJSON() {
          return { token: secret };
        },
      },
      { maxChars: 100, redactKeys: ["token"] },
    );

    expect(preview).toContain("[redacted]");
    expect(preview).not.toContain(secret);
  });

  it("truncates long previews", () => {
    expect(
      formatPreview({ text: "abcdefghijklmnopqrstuvwxyz" }, { maxChars: 24, redactKeys: [] }),
    ).toBe("text: abc...\n[truncated]");
  });
});
