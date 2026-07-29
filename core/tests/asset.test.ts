import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => import("@koishijs/core"));

import { h } from "koishi";

import { createAssetService } from "../src/asset.js";
import { ChannelStorage, type ChannelScope } from "../src/channel.js";

const scope: ChannelScope = {
  platform: "onebot",
  selfId: "bot-1",
  channelId: "room-42",
  isDirect: false,
};
const otherScope: ChannelScope = { ...scope, channelId: "room-43" };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_ID = createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 32);

describe("AssetService", () => {
  let basePath: string;
  let storage: ChannelStorage;

  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), "yesimbot-assets-"));
    storage = new ChannelStorage(basePath);
  });

  afterEach(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("stores copied bytes as a full content-id image element", async () => {
    const store = createAssetService(storage).createStore(scope);
    const source = PNG_BYTES.slice();
    const element = await store.put(source);
    source[0] = 0;

    expect(element).toEqual(h("img", { id: PNG_ID }));
    await expect(store.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
    await expect(store.get(PNG_ID.slice(0, 7))).resolves.toEqual(PNG_BYTES);
  });

  it("deduplicates bytes and shares a shared-channel store across Bots", async () => {
    const assets = createAssetService(storage);
    const first = assets.createStore(scope);
    const second = assets.createStore({ ...scope, selfId: "bot-2" });

    expect(await first.put(PNG_BYTES)).toEqual(h("img", { id: PNG_ID }));
    expect(await second.put(PNG_BYTES)).toEqual(h("img", { id: PNG_ID }));
    await expect(second.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
  });

  it("rejects invalid, absent, and ambiguous asset references", async () => {
    const store = createAssetService(storage).createStore(scope);
    const root = await storage.getStoragePath(scope);
    const assets = join(root, "assets");
    await mkdir(assets, { recursive: true });
    await writeFile(join(assets, "abcdef01111111111111111111111111"), PNG_BYTES);
    await writeFile(join(assets, "abcdef02222222222222222222222222"), PNG_BYTES);

    await expect(store.get("abc123")).rejects.toThrow("Invalid asset id");
    await expect(store.get("ABCDEF0")).rejects.toThrow("Invalid asset id");
    await expect(store.get("asset_abcdef0")).rejects.toThrow("Invalid asset id");
    await expect(store.get("1234567")).rejects.toThrow("Asset not found");
    await expect(store.get("abcdef0")).rejects.toThrow("Asset prefix is ambiguous");
  });

  it("clears only the current channel assets", async () => {
    const assets = createAssetService(storage);
    const first = assets.createStore(scope);
    const second = assets.createStore(otherScope);
    await first.put(PNG_BYTES);
    await second.put(PNG_BYTES);

    await first.clear();

    await expect(first.get(PNG_ID)).rejects.toThrow();
    await expect(second.get(PNG_ID)).resolves.toEqual(PNG_BYTES);
  });
});
