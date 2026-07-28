import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { ImageFreezer } from "../src/media/index.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scope = { platform: "test", selfId: "bot-1", channelId: "room-1", isDirect: false };

function createFreezer(maxCount = 4) {
  const assets = { put: vi.fn(async () => ({ assetId: "asset_image", mime: "image/png" as const })) };
  const policy = {
    enabled: true,
    maxCount,
    maxBytesPerImage: 5 * 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
    selection: "current-first" as const,
  };
  return { assets, freezer: new ImageFreezer({ scope, assets, policy }) };
}

describe("ImageFreezer", () => {
  it("keeps an extracted freeze callback bound while persisting a loaded image", async () => {
    const { assets, freezer } = createFreezer();
    const freezeImage = freezer.freezeImage;
    const load = vi.fn(async () => ({ data: PNG, mime: "image/png" }));

    await expect(freezeImage(h("img", { src: "https://example.test/image.png" }), load)).resolves.toEqual(
      h("img", { id: "asset_image", mime: "image/png" }),
    );

    expect(load).toHaveBeenCalledOnce();
    expect(assets.put).toHaveBeenCalledOnce();
    expect(assets.put).toHaveBeenCalledWith(scope, PNG);
  });

  it("accumulates image limits within one instance", async () => {
    const { assets, freezer } = createFreezer(1);
    const firstLoad = vi.fn(async () => ({ data: PNG, mime: "image/png" }));
    const secondLoad = vi.fn(async () => ({ data: PNG, mime: "image/png" }));

    await expect(
      freezer.freezeImage(h("img", { src: "https://example.test/first.png" }), firstLoad),
    ).resolves.toEqual(h("img", { id: "asset_image", mime: "image/png" }));
    await expect(
      freezer.freezeImage(h("img", { src: "https://example.test/second.png" }), secondLoad),
    ).resolves.toEqual(h("img", { unavailable: "true" }));

    expect(firstLoad).toHaveBeenCalledOnce();
    expect(secondLoad).not.toHaveBeenCalled();
    expect(assets.put).toHaveBeenCalledOnce();
  });
});
