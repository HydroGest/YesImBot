import { describe, expect, it } from "vitest";

import { formatReflectionTarget, patternPhrase, sanitizeForDisplay } from "../src/text.js";

describe("patternPhrase", () => {
  it("ignores media, urls, mentions, hashtags and bot status text", () => {
    expect(patternPhrase("[图片]")).toBe("");
    expect(patternPhrase("[动画表情: 猫猫 asset://abc]")).toBe("<sticker />");
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
    expect(sanitizeForDisplay("[动画表情: 猫猫 asset://abc]")).toContain("<sticker />");
  });

  it("normalizes mention ids and bare mentions to a placeholder", () => {
    expect(sanitizeForDisplay("@1328387967 收到")).toBe("@成员 收到");
    expect(sanitizeForDisplay("@ 禁言我")).toBe("@成员 禁言我");
  });
});

describe("formatReflectionTarget", () => {
  it("replaces image data and html with a short media summary", () => {
    const target = "&lt;img src=&quot;data:image/png;base64,iVBORw0KGgoAAAANSUhEUg&quot;&gt;";
    expect(formatReflectionTarget(target)).toBe("[图片]");
  });

  it("truncates long text targets", () => {
    expect(formatReflectionTarget("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
  });

  it("normalizes mention markup in reflection targets", () => {
    expect(formatReflectionTarget("<at id=\"1328387967\"/> 收到")).toBe("@成员 收到");
  });
});
