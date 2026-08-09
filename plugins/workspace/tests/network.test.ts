import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const { Schema } = await import("@koishijs/core");
  return { Context: class {}, Logger: class {}, Schema };
});

import { normalizeAllowedUrlPrefixes } from "../src/index";

describe("normalizeAllowedUrlPrefixes", () => {
  it("returns empty array for empty input", () => {
    expect(normalizeAllowedUrlPrefixes([])).toEqual([]);
  });

  it("accepts absolute HTTPS URLs without wildcard", () => {
    expect(normalizeAllowedUrlPrefixes(["https://github.com/example/"])).toEqual(["https://github.com/example/"]);
  });

  it("accepts absolute HTTP URLs", () => {
    expect(normalizeAllowedUrlPrefixes(["http://example.com/repo"])).toEqual(["http://example.com/repo"]);
  });

  it("strips terminal wildcard", () => {
    expect(normalizeAllowedUrlPrefixes(["https://github.com/example/*"])).toEqual(["https://github.com/example/"]);
  });

  it("handles multiple entries", () => {
    const result = normalizeAllowedUrlPrefixes(["https://github.com/org1/*", "https://gitlab.com/org2/"]);
    expect(result).toEqual(["https://github.com/org1/", "https://gitlab.com/org2/"]);
  });

  it("rejects non-absolute URLs", () => {
    expect(() => normalizeAllowedUrlPrefixes(["github.com/example/*"])).toThrow(/absolute HTTP/);
  });

  it("rejects ftp scheme", () => {
    expect(() => normalizeAllowedUrlPrefixes(["ftp://example.com/"])).toThrow(/absolute HTTP/);
  });

  it("rejects wildcard in scheme position", () => {
    expect(() => normalizeAllowedUrlPrefixes(["*://github.com/"])).toThrow(/absolute HTTP/);
  });

  it("rejects wildcard in host position", () => {
    expect(() => normalizeAllowedUrlPrefixes(["https://*.github.com/"])).toThrow(/wildcard in an unsupported position/);
  });

  it("rejects wildcard in middle of path", () => {
    expect(() => normalizeAllowedUrlPrefixes(["https://github.com/*/repo"])).toThrow(/wildcard in an unsupported position/);
  });

  it("skips empty strings and falsy entries", () => {
    expect(normalizeAllowedUrlPrefixes(["", "  ", "https://github.com/ok"])).toEqual(["https://github.com/ok"]);
  });

  it("trims whitespace", () => {
    expect(normalizeAllowedUrlPrefixes(["  https://github.com/example/*  "])).toEqual(["https://github.com/example/"]);
  });

  it("does not turn an empty allowlist into full Internet access", () => {
    const result = normalizeAllowedUrlPrefixes([]);
    expect(result).toEqual([]);
  });
});
