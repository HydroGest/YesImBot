import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { channelIdentity, type ChannelScope } from "../src/channel/index.js";
import { AssetStore } from "../src/media/index.js";
import { ChannelStorage } from "../src/storage/index.js";
import { channelRecord } from "../src/storage/manifest.js";

const scope: ChannelScope = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
  isDirect: false,
};
const otherScope: ChannelScope = { ...scope, channelId: "room-43" };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngBytesOfLength(byteLength: number): Uint8Array {
  const data = new Uint8Array(byteLength);
  data.set(PNG_BYTES);
  return data;
}

describe("AssetStore", () => {
  let basePath: string;
  let storage: ChannelStorage;
  let assets: AssetStore;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-assets-"));
    storage = new ChannelStorage(basePath);
    assets = new AssetStore({
      storage,
      policy: {
        enabled: true,
        maxCount: 4,
        maxBytesPerImage: 16,
        maxTotalBytes: 16,
        selection: "current-first",
      },
    });
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("round-trips a private image and rejects an invalid asset id", async () => {
    const stored = await assets.put(scope, PNG_BYTES);
    const hash = stored.assetId.slice("asset_".length);
    const channel = channelRecord(scope);

    await expect(assets.readByAssetId(scope, stored.assetId)).resolves.toEqual(PNG_BYTES);
    await expect(
      readFile(join(basePath, "channels", channel.directoryName, "assets", hash)),
    ).resolves.toEqual(Buffer.from(PNG_BYTES));
    expect(channel).toMatchObject({
      identity: channelIdentity(scope),
      directoryName: "v1-shared-onebot-room_42",
    });
    await expect(assets.readByAssetId(scope, "asset_invalid")).rejects.toThrow(
      "Invalid platform asset id",
    );
  });

  it("clears only assets from the requested channel", async () => {
    const stored = await assets.put(scope, PNG_BYTES);
    const other = await assets.put(otherScope, PNG_BYTES);

    await assets.clear(scope);

    await expect(assets.readByAssetId(scope, stored.assetId)).rejects.toThrow();
    await expect(assets.readByAssetId(otherScope, other.assetId)).resolves.toEqual(PNG_BYTES);
  });

  it("rejects an image above the unified per-image byte budget", async () => {
    const limited = new AssetStore({
      storage,
      policy: {
        enabled: true,
        maxCount: 1,
        maxBytesPerImage: 8,
        maxTotalBytes: 8,
        selection: "current-first",
      },
    });

    await expect(limited.put(scope, pngBytesOfLength(9))).rejects.toThrow("Image exceeds 8 bytes");
  });
});
