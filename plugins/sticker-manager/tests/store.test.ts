import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChannelScope } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it } from "vitest";

import { StickerFileStore } from "../src/files.js";
import { StickerStore } from "../src/store.js";
import { scopeKeyFor, type StickerRow } from "../src/types.js";
import { createMemoryModel } from "./helpers.js";

const sharedScope: ChannelScope = {
  type: "shared",
  platform: "test",
  selfId: "bot-1",
  channelId: "room-1",
};

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
]);

describe("StickerStore", () => {
  let baseDir = "";

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  async function createStore() {
    baseDir = await mkdtemp(join(tmpdir(), "sticker-store-"));
    const files = new StickerFileStore(baseDir, "data");
    const model = createMemoryModel<StickerRow>();
    const store = new StickerStore(model as never, files);
    await store.ensure();
    return { store, files, model };
  }

  it("saves content-addressed stickers and deduplicates by bytes", async () => {
    const { store } = await createStore();
    const first = await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      source: { kind: "steal" },
    });
    expect(first.status).toBe("created");

    const second = await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "other",
      source: { kind: "steal" },
    });
    expect(second.status).toBe("duplicate");
    expect(second.sticker.id).toBe(first.sticker.id);
    expect(second.sticker.category).toBe("meme");
  });

  it("keeps shared channel scope keys independent of selfId", () => {
    expect(scopeKeyFor(sharedScope, { scope: "channel" })).toBe("shared:test:room-1");
    expect(scopeKeyFor({ ...sharedScope, selfId: "bot-2" }, { scope: "channel" })).toBe("shared:test:room-1");
  });

  it("isolates global and channel rows while sharing content files", async () => {
    const { store, files } = await createStore();
    await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "global-meme",
      source: { kind: "steal" },
    });
    const channelKey = scopeKeyFor(sharedScope, { scope: "channel" });
    await store.save({
      scopeKey: channelKey,
      bytes: pngBytes,
      mediaType: "image/png",
      category: "channel-meme",
      source: { kind: "steal" },
    });

    expect((await store.listCategories("global")).map((item) => item.category)).toEqual(["global-meme"]);
    expect((await store.listCategories(channelKey)).map((item) => item.category)).toEqual(["channel-meme"]);
    expect(await files.exists(await contentId(store, "global"))).toBe(true);
  });

  it("removes files only after the last referencing scope is gone", async () => {
    const { store, files } = await createStore();
    const globalKey = "global";
    const channelKey = scopeKeyFor(sharedScope, { scope: "channel" });
    await store.save({
      scopeKey: globalKey,
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      source: { kind: "steal" },
    });
    await store.save({
      scopeKey: channelKey,
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      source: { kind: "steal" },
    });

    await store.deleteCategory(globalKey, "meme");
    expect(await files.list()).toHaveLength(1);

    await store.deleteCategory(channelKey, "meme");
    expect(await files.list()).toHaveLength(0);
  });

  it("cleanup deletes orphan files and reports missing records", async () => {
    const { store, files } = await createStore();
    await store.save({
      scopeKey: "global",
      bytes: pngBytes,
      mediaType: "image/png",
      category: "meme",
      source: { kind: "steal" },
    });
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
