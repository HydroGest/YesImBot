import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "koishi";
import { afterEach, describe, expect, it } from "vitest";

import { StickerFileStore } from "../src/files.js";
import { migrateV3 } from "../src/migrate.js";
import { StickerStore } from "../src/store.js";
import type { StickerRow } from "../src/types.js";
import { createMemoryModel } from "./helpers.js";

describe("migrateV3", () => {
  let baseDir = "";

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it("imports matching v3 records into the active global scope", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "sticker-migrate-"));
    const oldDir = join(baseDir, "old");
    const dataDir = join(baseDir, "data");
    const oldFile = join(oldDir, "sticker.png");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await mkdir(oldDir, { recursive: true });
    await writeFile(oldFile, bytes);

    const files = new StickerFileStore(baseDir, "data");
    const model = createMemoryModel<StickerRow>();
    const store = new StickerStore(model as never, files);
    const database = {
      get: async () => [
        {
          id: "v3-1",
          category: "meme",
          filePath: "sticker.png",
          source: { platform: "test", channelId: "room-1", userId: "u", messageId: "m" },
        },
      ],
    };

    const result = await migrateV3({
      ctx: { database } as unknown as Context,
      store,
      scopeKey: "global",
      sourceDir: oldDir,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(await store.listCategories("global")).toMatchObject([{ category: "meme", count: 1 }]);
    expect(await files.list()).toHaveLength(1);
    void dataDir;
  });

  it("dry-run reports imports without writing rows", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "sticker-migrate-dry-"));
    const oldDir = join(baseDir, "old");
    const oldFile = join(oldDir, "sticker.png");
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await mkdir(oldDir, { recursive: true });
    await writeFile(oldFile, bytes);

    const model = createMemoryModel<StickerRow>();
    const store = new StickerStore(model as never, new StickerFileStore(baseDir, "data"));
    const database = {
      get: async () => [
        {
          id: "v3-1",
          category: "meme",
          filePath: "sticker.png",
          source: { platform: "test", channelId: "room-1", userId: "u", messageId: "m" },
        },
      ],
    };

    const result = await migrateV3({
      ctx: { database } as unknown as Context,
      store,
      scopeKey: "global",
      sourceDir: oldDir,
      dryRun: true,
    });

    expect(result.imported).toBe(1);
    expect(await store.listCategories("global")).toHaveLength(0);
  });
});
