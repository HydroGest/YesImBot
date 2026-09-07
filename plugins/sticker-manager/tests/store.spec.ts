import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ChannelContext } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it } from "vitest";

import { StickerFileStore } from "../src/files.js";
import { StickerStore } from "../src/store.js";
import { scopeKeyFor, type StickerRow } from "../src/types.js";
import { createMemoryModel } from "./helpers.js";

const sharedScope: ChannelContext = { type: "guild", platform: "test", channelId: "room-1", guildId: "room-1" };

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);

describe("StickerStore", () => {
  let baseDir = "";

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  async function createStore() {
    baseDir = await mkdtemp(path.join(tmpdir(), "sticker-store-"));
    const files = new StickerFileStore(baseDir, "data");
    const model = createMemoryModel<StickerRow>();
    const store = new StickerStore(model as never, files);
    await store.ensure();
    return { store, files, model };
  }

  it("saves content-addressed stickers and deduplicates by bytes", async () => {
    const { store } = await createStore();
    const first = await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "meme", source: { kind: "steal" } });
    expect(first.status).toBe("created");

    const second = await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "other", source: { kind: "steal" } });
    expect(second.status).toBe("duplicate");
    expect(second.sticker.id).toBe(first.sticker.id);
    expect(second.sticker.category).toBe("meme");
  });

  it("stores normalized tags and exposes them in projections", async () => {
    const { store } = await createStore();
    const result = await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      tags: [" 猫猫 ", "猫猫", "开心"],
      source: { kind: "steal" },
    });
    expect(result).toMatchObject({ status: "created", sticker: { tags: ["猫猫", "开心"] } });
  });

  it("merges tags into an existing sticker on duplicate saves", async () => {
    const { store } = await createStore();
    await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "meme", source: { kind: "steal" } });
    const tagged = await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      tags: ["猫猫"],
      source: { kind: "steal" },
    });
    const second = await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      tags: ["开心"],
      source: { kind: "steal" },
    });
    expect(tagged).toMatchObject({ status: "duplicate", sticker: { tags: ["猫猫"] } });
    expect(second).toMatchObject({ status: "duplicate", sticker: { tags: ["猫猫", "开心"] } });
  });

  it("updates classification and tags for a sticker", async () => {
    const { store } = await createStore();
    const result = await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "meme", tags: ["旧"], source: { kind: "steal" } });

    await store.updateClassification("global", result.sticker.id, "有趣", ["新", "旧"]);
    const [sticker] = await store.listByScopeKey("global");

    expect(sticker).toMatchObject({ category: "有趣", tags: ["新", "旧"] });
  });

  it("searches and summarizes tags", async () => {
    const { store } = await createStore();
    const bytesA = new Uint8Array([...pngBytes, 1]);
    const bytesB = new Uint8Array([...pngBytes, 2]);
    const bytesC = new Uint8Array([...pngBytes, 3]);
    await store.save({ scopeKey: "global", bytes: bytesA, mediaType: "image/png", category: "a", tags: ["猫猫", "开心"], source: { kind: "steal" } });
    await store.save({ scopeKey: "global", bytes: bytesB, mediaType: "image/png", category: "b", tags: ["猫猫"], source: { kind: "steal" } });
    await store.save({ scopeKey: "global", bytes: bytesC, mediaType: "image/png", category: "c", tags: ["工作"], source: { kind: "steal" } });

    expect(await store.search("global", { tags: ["猫猫"], limit: 50 })).toHaveLength(2);
    expect(await store.search("global", { tags: ["猫猫", "开心"], matchAllTags: true, limit: 50 })).toHaveLength(1);
    expect(await store.search("global", { keyword: "开心", limit: 50 })).toHaveLength(1);
    expect(await store.listTags("global")).toEqual([
      { tag: "工作", count: 1 },
      { tag: "开心", count: 1 },
      { tag: "猫猫", count: 2 },
    ]);
  });

  it("keeps shared channel scope keys independent of selfId", () => {
    expect(scopeKeyFor(sharedScope, { scope: "channel" })).toBe("group:test:room-1");
    expect(scopeKeyFor({ ...sharedScope, selfId: "bot-2" }, { scope: "channel" })).toBe("group:test:room-1");
  });

  it("isolates global and channel rows while sharing content files", async () => {
    const { store, files } = await createStore();
    await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "global-meme", source: { kind: "steal" } });
    const channelKey = scopeKeyFor(sharedScope, { scope: "channel" });
    await store.save({ scopeKey: channelKey, bytes: pngBytes, mediaType: "image/png", category: "channel-meme", source: { kind: "steal" } });

    expect((await store.listCategories("global")).map((item) => item.category)).toEqual(["global-meme"]);
    expect((await store.listCategories(channelKey)).map((item) => item.category)).toEqual(["channel-meme"]);
    expect(await files.exists(await contentId(store, "global"))).toBe(true);
  });

  it("removes files only after the last referencing scope is gone", async () => {
    const { store, files } = await createStore();
    const globalKey = "global";
    const channelKey = scopeKeyFor(sharedScope, { scope: "channel" });
    await store.save({ scopeKey: globalKey, bytes: pngBytes, mediaType: "image/png", category: "meme", source: { kind: "steal" } });
    await store.save({ scopeKey: channelKey, bytes: pngBytes, mediaType: "image/png", category: "meme", source: { kind: "steal" } });

    await store.deleteCategory(globalKey, "meme");
    expect(await files.list()).toHaveLength(1);

    await store.deleteCategory(channelKey, "meme");
    expect(await files.list()).toHaveLength(0);
  });

  it("cleanup deletes orphan files and reports missing records", async () => {
    const { store, files } = await createStore();
    await store.save({ scopeKey: "global", bytes: pngBytes, mediaType: "image/png", category: "meme", source: { kind: "steal" } });
    await files.write(webpBytes, "0000000000000000000000000000000000000000000000000000000000000000");
    const result = await store.cleanup();
    expect(result.deletedOrphanFiles).toBe(1);
    expect(result.missingFiles).toHaveLength(0);
  });
});

async function contentId(store: StickerStore, scopeKey: string): Promise<string> {
  const rows = await store.listByScopeKey(scopeKey);
  return rows[0]!.id;
}
