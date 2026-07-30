import type { OneBot } from "koishi-plugin-adapter-onebot";
import { describe, expect, it, vi } from "vitest";

import { createForwardReader } from "../src/forward.js";
import type {
  OneBotForwardNode,
  OneBotForwardSegment,
} from "../src/types.js";

function node(
  message: OneBotForwardSegment[],
  overrides: Partial<OneBotForwardNode> = {},
): OneBotForwardNode {
  return {
    sender: { user_id: 10001, nickname: "Alice", card: "" },
    time: 1_753_888_000,
    message,
    raw_message: "[CQ:ignored]",
    ...overrides,
  } as OneBotForwardNode;
}

function createReader(
  records: readonly OneBotForwardNode[],
  config = { parseImages: false, maxForwardPageChars: 6000 },
) {
  const getForwardMsg = vi.fn(async () => records);
  const reader = createForwardReader({ getForwardMsg } as OneBot.Internal, config);
  return { getForwardMsg, reader };
}

describe("createForwardReader", () => {
  it("projects array text exactly instead of reading raw CQ text", async () => {
    const { reader } = createReader([
      node([{ type: "text", data: { text: "https://example.test/docs" } }]),
    ]);

    await expect(reader({ messageId: "forward" })).resolves.toEqual({
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
        { type: "unknown", data: {} } as OneBotForwardSegment,
      ]),
    ]);

    await expect(reader({ messageId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["hello[图片] world[文件][未知消息段]"]]],
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
      { parseImages: true, maxForwardPageChars: 6000 },
    );

    const result = await reader({ messageId: "forward" });

    expect(result).toEqual({
      messages: [
        [
          "Alice (10001)",
          expect.any(String),
          ["before", { image: ["cover", "cover.jpg", "52.8 KB"] }, "after"],
        ],
        ["Alice (10001)", expect.any(String), [{ image: ["", "one.bin", "1.0 KB"] }]],
        ["Alice (10001)", expect.any(String), [{ image: ["", "bad.bin", null] }]],
        ["Alice (10001)", expect.any(String), [{ image: ["", "unsafe.bin", null] }]],
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private.test");
    expect(JSON.stringify(result)).not.toContain("sub_type");
  });

  it("returns nested forward IDs without expanding their content", async () => {
    const { reader } = createReader([
      node([
        {
          type: "forward",
          data: {
            id: "child-forward",
            content: [node([{ type: "text", data: { text: "must not appear" } }])],
          },
        },
      ]),
    ]);

    await expect(reader({ messageId: "forward" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), [{ forward: "child-forward" }]]],
    });
  });

  it("caches normalized records while paging from the requested offset", async () => {
    const { reader, getForwardMsg } = createReader([
      node([{ type: "text", data: { text: "a".repeat(3500) } }]),
      node([{ type: "text", data: { text: "b".repeat(3500) } }]),
    ]);

    await expect(reader({ messageId: "forward" })).resolves.toMatchObject({
      messages: [["Alice (10001)", expect.any(String), ["a".repeat(3500)]]],
      nextOffset: 1,
    });
    await expect(reader({ messageId: "forward", offset: 1 })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["b".repeat(3500)]]],
    });
    expect(getForwardMsg).toHaveBeenCalledTimes(1);
  });

  it("returns a complete oversized first record as an over-limit singleton", async () => {
    const { reader } = createReader([
      node([{ type: "text", data: { text: "a".repeat(6001) } }]),
      node([{ type: "text", data: { text: "later" } }]),
    ]);

    await expect(reader({ messageId: "forward" })).resolves.toMatchObject({
      messages: [["Alice (10001)", expect.any(String), ["a".repeat(6001)]]],
      nextOffset: 1,
      overLimit: true,
    });
  });

  it("clamps direct page inputs and returns an empty terminal page", async () => {
    const { reader } = createReader(
      Array.from({ length: 21 }, (_, index) =>
        node([{ type: "text", data: { text: String(index) } }]),
      ),
    );

    const firstPage = await reader({ messageId: "forward", offset: -3, limit: 99 });

    expect(firstPage.messages).toHaveLength(20);
    expect(firstPage.nextOffset).toBe(20);
    await expect(reader({ messageId: "forward", offset: 99 })).resolves.toEqual({ messages: [] });
  });

  it("retries failed loads and keeps cache entries independent by forward ID", async () => {
    const getForwardMsg = vi
      .fn<OneBot.Internal["getForwardMsg"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce([node([{ type: "text", data: { text: "first" } }])])
      .mockResolvedValueOnce([node([{ type: "text", data: { text: "second" } }])]);
    const reader = createForwardReader(
      { getForwardMsg } as OneBot.Internal,
      { parseImages: false, maxForwardPageChars: 6000 },
    );

    await expect(reader({ messageId: "first" })).rejects.toThrow("temporary");
    await expect(reader({ messageId: "first" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["first"]]],
    });
    await expect(reader({ messageId: "second" })).resolves.toEqual({
      messages: [["Alice (10001)", expect.any(String), ["second"]]],
    });
    expect(getForwardMsg).toHaveBeenCalledTimes(3);
  });
});
