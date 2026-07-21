import { h } from "koishi";
import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import type { ChannelScope } from "../src/channel.js";
import {
  literalToElements,
  messageFromRecord,
  projectPlatformMessage,
} from "../src/platform/message.js";
import type { Platform } from "../src/platform/types.js";

function fakeAssetStore(): {
  readByAssetId: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  return {
    readByAssetId: vi.fn(),
    clear: vi.fn(),
  };
}

const scope: ChannelScope = {
  platform: "test",
  selfId: "bot",
  channelId: "room",
};

const baseData: Platform.MessageRecord = {
  source: { platform: "test", selfId: "bot" },
  scope: { type: "channel", channelId: "room", channelType: "group" },
  sender: { id: "u1", name: "Alice" },
  messageId: "m1",
  receivedAt: Date.parse("2026-07-18T12:34:00+08:00"),
  content: "hello world",
};

describe("message persistence helpers", () => {
  it("round-trips persisted content through literalToElements and back", () => {
    const elements = literalToElements('hello <at id="42"/>');
    expect(elements.length).toBeGreaterThanOrEqual(2);
    const roundTripped = elements.map((el) => el.toString()).join("");
    expect(roundTripped).toBe('hello <at id="42"/>');
  });

  it("messageFromRecord reconstructs elements", () => {
    const data: Platform.MessageRecord = {
      ...baseData,
      content: '<at id="bot"/> hello',
    };
    const msg = messageFromRecord(data);
    expect(msg.elements.length).toBeGreaterThanOrEqual(2);
    expect(msg.sender).toEqual({ id: "u1", name: "Alice" });
    expect(msg.scope).toEqual({ type: "channel", channelId: "room", channelType: "group" });
  });

  it("preserves channelType and rejects legacy records", () => {
    const record = {
      ...baseData,
      scope: { type: "channel" as const, channelId: "room", channelType: "group" as const },
    } as unknown as Platform.MessageRecord;

    expect(messageFromRecord(record).scope.channelType).toBe("group");

    const legacy = {
      ...record,
      scope: { type: "channel", channelId: "room" },
    } as unknown as Platform.MessageRecord;
    expect(() => messageFromRecord(legacy)).toThrow("channelType");
  });
});

describe("projectPlatformMessage", () => {
  it("projects a text-only message with header", async () => {
    const store = fakeAssetStore();
    const result = await projectPlatformMessage(baseData, {
      scope,
      assetStore: store as never,
      includeMessageId: false,
    });
    expect(result.role).toBe("user");
    expect(typeof result.content).toBe("string");
    expect(result.content).toMatch(/^\[time="/);
    expect(result.content).toContain("hello world");
  });

  it("includes message id in header when requested", async () => {
    const store = fakeAssetStore();
    const result = await projectPlatformMessage(baseData, {
      scope,
      assetStore: store as never,
      includeMessageId: true,
    });
    expect(result.content).toContain('id="m1"');
  });

  it("projects local asset images without network", async () => {
    const store = fakeAssetStore();
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    store.readByAssetId.mockResolvedValue(pngBytes);

    const data: Platform.MessageRecord = {
      ...baseData,
      content: 'look <img id="asset_abc" mime="image/png"/>',
    };
    const result = await projectPlatformMessage(data, {
      scope,
      assetStore: store as never,
      includeMessageId: false,
    });

    expect(store.readByAssetId).toHaveBeenCalledWith(scope, "asset_abc");
    if (Array.isArray(result.content)) {
      const imagePart = result.content.find((p: Record<string, unknown>) => p.type === "image");
      expect(imagePart).toBeDefined();
      expect((imagePart as Record<string, unknown>).image).toBe(pngBytes);
    }
  });

  it("projects nested text and local images in document order", async () => {
    const store = fakeAssetStore();
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    store.readByAssetId.mockResolvedValue(pngBytes);
    const data: Platform.MessageRecord = {
      ...baseData,
      content: '<p>before<img id="asset_nested" mime="image/png"/>after</p>',
    };

    const result = await projectPlatformMessage(data, {
      scope,
      assetStore: store as never,
      includeMessageId: false,
    });

    expect(store.readByAssetId).toHaveBeenCalledWith(scope, "asset_nested");
    expect(result.content).toEqual(expect.any(Array));
    const parts = result.content as Array<Record<string, unknown>>;
    expect(parts.map((part) => part.type)).toEqual(["text", "image", "text"]);
    expect(parts[0]?.text).toContain("before");
    expect(parts[1]?.image).toBe(pngBytes);
    expect(parts[2]?.text).toContain("after");
  });

  it("calls onAssetMissing when image asset is unavailable", async () => {
    const store = fakeAssetStore();
    store.readByAssetId.mockRejectedValue(new Error("not found"));
    const onAssetMissing = vi.fn();

    const data: Platform.MessageRecord = {
      ...baseData,
      content: '<img id="asset_missing" mime="image/png"/>',
    };
    await projectPlatformMessage(data, {
      scope,
      assetStore: store as never,
      includeMessageId: false,
      onAssetMissing,
    });

    expect(onAssetMissing).toHaveBeenCalledWith("asset_missing", expect.any(Error));
  });
});
