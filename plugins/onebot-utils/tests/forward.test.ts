import type { OneBot } from "koishi-plugin-adapter-onebot";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { createForwardReader } from "../src/forward.js";

function node(message: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    sender: { user_id: 10001, nickname: "Alice", card: "" },
    time: 1_753_888_000,
    message,
    raw_message: "[CQ:ignored]",
    ...overrides,
  };
}

function createReader(
  records: readonly unknown[],
  config = { parseImages: false, maxForwardPageChars: 6000, attachImageSummary: true },
) {
  const getForwardMsg = vi.fn(async () => records);
  const reader = createForwardReader({ getForwardMsg } as OneBot.Internal, config);
  return { getForwardMsg, reader };
}

describe("createForwardReader", () => {
  it("projects array text exactly instead of reading raw CQ text", async () => {
    const { reader } = createReader([node([{ type: "text", data: { text: "https://example.test/docs" } }])]);

    await expect(reader({ forwardId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["https://example.test/docs"]]],
    });
  });

  it("uses text placeholders and coalesces adjacent string parts when images are disabled", async () => {
    const { reader } = createReader([
      node([
        { type: "text", data: { text: "hello" } },
        { type: "image", data: { summary: "cover", file: "cover.jpg", file_size: "52762" } },
        { type: "text", data: { text: " world" } },
        { type: "file", data: {} },
        { type: "unknown", data: {} },
      ]),
    ]);

    await expect(reader({ forwardId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["hello[图片] world[文件][未知消息段]"]]],
    });
  });

  it("uses an animated emoji placeholder when image subtype is one", async () => {
    const { reader } = createReader([node([{ type: "image", data: { summary: "", file: "face.gif", sub_type: 1 } }])]);

    await expect(reader({ forwardId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["[动画表情]"]]],
    });
  });

  it("attaches image summary to animated emoji placeholders when enabled", async () => {
    const { reader } = createReader([
      node([{ type: "image", data: { summary: "大笑", file: "face.gif", sub_type: 1 } }]),
    ]);

    await expect(reader({ forwardId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["[动画表情: 大笑]"]]],
    });
  });

  it("projects enabled image metadata without URLs or subtypes", async () => {
    const { reader } = createReader(
      [
        node([
          { type: "text", data: { text: "before" } },
          {
            type: "image",
            data: {
              summary: "cover",
              file: "cover.jpg",
              file_size: "52762",
              url: "https://private.test/cover.jpg",
              sub_type: 1,
            },
          },
          { type: "text", data: { text: "after" } },
        ]),
        node([{ type: "image", data: { summary: "", file: "one.bin", file_size: "1000" } }]),
        node([{ type: "image", data: { summary: "", file: "bad.bin", file_size: "-1" } }]),
        node([
          {
            type: "image",
            data: { summary: "", file: "unsafe.bin", file_size: "9007199254740992" },
          },
        ]),
      ],
      { parseImages: true, maxForwardPageChars: 6000, attachImageSummary: true },
    );

    const result = await reader({ forwardId: "forward" });

    expect(result).toEqual({
      messages: [
        ["Alice (10001)", expect.any(String), ["before", { image: ["cover", "cover.jpg", "52.8 KB"] }, "after"]],
        ["Alice (10001)", expect.any(String), [{ image: ["", "one.bin", "1.0 KB"] }]],
        ["Alice (10001)", expect.any(String), [{ image: ["", "bad.bin", null] }]],
        ["Alice (10001)", expect.any(String), [{ image: ["", "unsafe.bin", null] }]],
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private.test");
    expect(JSON.stringify(result)).not.toContain("sub_type");
  });

  it("renders persisted forward images as local asset URIs", async () => {
    const getForwardMsg = vi.fn(async () => [
      node([
        {
          type: "image",
          data: {
            summary: "cover",
            file: "cover.jpg",
            file_size: "1000",
            src: "https://private.test/cover.jpg",
          },
        },
      ]),
    ]);
    const persistImages = vi.fn(
      async (images) => new Map(images.map((image, index) => [image.file, `asset-${index}`])),
    );
    const reader = createForwardReader({ getForwardMsg } as OneBot.Internal, {
      parseImages: true,
      maxForwardPageChars: 6000,
      attachImageSummary: true,
      persistImages,
    });

    const result = await reader({ forwardId: "forward" });
    expect(result).toEqual({
      messages: [["Alice (10001)", expect.any(String), ["[图片：asset://asset-0]"]]],
    });
    expect(persistImages).toHaveBeenCalledWith([
      { file: "cover.jpg", summary: "cover", url: "https://private.test/cover.jpg" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private.test");
  });

  it("caches expanded nested forwards under their forward ID", async () => {
    const { reader, getForwardMsg } = createReader([
      node([
        {
          type: "forward",
          data: {
            id: "child-forward",
            content: [node([{ type: "text", data: { text: "cached child" } }])],
          },
        },
      ]),
    ]);

    await expect(reader({ forwardId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), [{ forward: "child-forward" }]]],
    });
    await expect(reader({ forwardId: "child-forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["cached child"]]],
    });
    expect(getForwardMsg).toHaveBeenCalledOnce();
  });

  it("returns a clear error result when neither cache nor OneBot has a forward", async () => {
    const reader = createForwardReader({ getForwardMsg: vi.fn(async () => undefined) } as OneBot.Internal, {
      parseImages: false,
      maxForwardPageChars: 6000,
      attachImageSummary: true,
    });

    await expect(reader({ forwardId: "missing" })).resolves.toEqual({
      error: "未找到合并转发消息: missing",
    });
  });

  it("caches normalized records while paging from the requested offset", async () => {
    const { reader, getForwardMsg } = createReader([
      node([{ type: "text", data: { text: "a".repeat(3500) } }]),
      node([{ type: "text", data: { text: "b".repeat(3500) } }]),
    ]);

    await expect(reader({ forwardId: "forward" })).resolves.toMatchObject({
      messages: [["Alice (10001)", expect.any(String), ["a".repeat(3500)]]],
      nextOffset: 1,
      tips: "还有 1 条消息未读取；如需继续，请使用相同 forwardId 和 nextOffset 1。",
    });
    await expect(reader({ forwardId: "forward", offset: 1 })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["b".repeat(3500)]]],
    });
    expect(getForwardMsg).toHaveBeenCalledTimes(1);
  });

  it("returns a complete oversized first record as an over-limit singleton", async () => {
    const { reader } = createReader([
      node([{ type: "text", data: { text: "a".repeat(6001) } }]),
      node([{ type: "text", data: { text: "later" } }]),
    ]);

    await expect(reader({ forwardId: "forward" })).resolves.toMatchObject({
      messages: [["Alice (10001)", expect.any(String), ["a".repeat(6001)]]],
      nextOffset: 1,
      overLimit: true,
      tips: "还有 1 条消息未读取；如需继续，请使用相同 forwardId 和 nextOffset 1。",
    });
  });

  it("defaults to thirty records, clamps direct page inputs, and returns an empty terminal page", async () => {
    const { reader } = createReader(
      Array.from({ length: 61 }, (_, index) => node([{ type: "text", data: { text: String(index) } }])),
    );

    const defaultPage = await reader({ forwardId: "forward" });
    const clampedPage = await reader({ forwardId: "forward", offset: -3, limit: 99 });

    expect(defaultPage.messages).toHaveLength(30);
    expect(defaultPage.nextOffset).toBe(30);
    expect(defaultPage.tips).toBe("还有 31 条消息未读取；如需继续，请使用相同 forwardId 和 nextOffset 30。");
    expect(clampedPage.messages).toHaveLength(60);
    expect(clampedPage.nextOffset).toBe(60);
    expect(clampedPage.tips).toBe("还有 1 条消息未读取；如需继续，请使用相同 forwardId 和 nextOffset 60。");
    await expect(reader({ forwardId: "forward", offset: 99 })).resolves.toEqual({ messages: [] });
  });

  it("retries failed loads and keeps cache entries independent by forward ID", async () => {
    const getForwardMsg = vi
      .fn<OneBot.Internal["getForwardMsg"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([node([{ type: "text", data: { text: "first" } }])])
      .mockResolvedValueOnce([node([{ type: "text", data: { text: "second" } }])]);
    const reader = createForwardReader({ getForwardMsg } as OneBot.Internal, {
      parseImages: false,
      maxForwardPageChars: 6000,
      attachImageSummary: true,
    });

    await expect(reader({ forwardId: "first" })).rejects.toThrow("temporary");
    await expect(reader({ forwardId: "first" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["first"]]],
    });
    await expect(reader({ forwardId: "second" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["second"]]],
    });
    expect(getForwardMsg).toHaveBeenCalledTimes(3);
  });
});
