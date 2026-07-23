import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { type ChannelScope } from "../src/channel/index.js";
import { AssetStore } from "../src/shared/asset.js";

const scope: ChannelScope = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
  isDirect: false,
};
const otherScope: ChannelScope = { ...scope, channelId: "room?a" };
const collidingScope: ChannelScope = { ...scope, channelId: "room/a" };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("AssetStore", () => {
  let basePath: string;
  let assets: AssetStore;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-assets-"));
    assets = new AssetStore({ basePath, maxFileBytes: 16 });
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("round-trips a private image and rejects an invalid asset id", async () => {
    const stored = await assets.put(scope, PNG_BYTES);

    await expect(assets.readByAssetId(scope, stored.assetId)).resolves.toEqual(PNG_BYTES);
    await expect(assets.readByAssetId(scope, "asset_invalid")).rejects.toThrow(
      "Invalid platform asset id",
    );
  });

  it("clears only assets from the requested channel", async () => {
    const stored = await assets.put(collidingScope, PNG_BYTES);
    const other = await assets.put(otherScope, PNG_BYTES);

    await assets.clear(collidingScope);

    await expect(assets.readByAssetId(collidingScope, stored.assetId)).rejects.toThrow();
    await expect(assets.readByAssetId(otherScope, other.assetId)).resolves.toEqual(PNG_BYTES);
  });
});
