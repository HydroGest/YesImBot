import { describe, expect, it } from "vitest";

import { patternPhrase, sanitizeForDisplay } from "../src/text.js";

describe("patternPhrase", () => {
  it("ignores media, urls, mentions, hashtags and bot status text", () => {
    expect(patternPhrase("[图片]")).toBe("");
    expect(patternPhrase("[动画表情: [动画表情] asset://abc]")).toBe("");
    expect(patternPhrase("https://x.com/status/123")).toBe("");
    expect(patternPhrase("@1272742391 ")).toBe("");
    expect(patternPhrase("#nailong")).toBe("");
    expect(patternPhrase("正在检测……")).toBe("");
  });

  it("keeps meaningful short group phrases", () => {
    expect(patternPhrase("确实")).toBe("确实");
    expect(patternPhrase("后六位是114514")).toBe("后六位是114514");
  });
});

describe("sanitizeForDisplay", () => {
  it("shortens urls and asset references for preview context", () => {
    expect(sanitizeForDisplay("https://x.com/status/123 [图片]")).toContain("[链接]");
    expect(sanitizeForDisplay("[动画表情: [动画表情] asset://abc]")).not.toContain("asset://");
  });
});
