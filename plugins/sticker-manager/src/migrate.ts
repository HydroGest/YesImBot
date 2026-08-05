import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Context } from "koishi";

import { detectImageMediaType, sha256Hex } from "./files.js";
import type { StickerStore } from "./store.js";
import type { MigrationResult, StickerSource } from "./types.js";

const V3_STICKER_TABLE = "yesimbot.stickers";

interface V3StickerRow {
  id: string;
  category: string;
  filePath: string;
  source: {
    platform: string;
    channelId: string;
    userId: string;
    messageId: string;
  };
  createdAt?: Date | string;
}

declare module "koishi" {
  interface Tables {
    [V3_STICKER_TABLE]: V3StickerRow;
  }
}

export interface MigrateV3Options {
  ctx: Context;
  store: StickerStore;
  scopeKey: string;
  channelMatch?: {
    platform: string;
    channelId: string;
  };
  includeUnsourced?: boolean;
  sourceDir?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface MigrateScopeOptions {
  store: StickerStore;
  fromScopeKey: string;
  toScopeKey: string;
  limit?: number;
  removeSource?: boolean;
}

export async function migrateV3(options: MigrateV3Options): Promise<MigrationResult> {
  const stats = emptyMigrationStats();
  let rows: V3StickerRow[];
  try {
    rows = (await options.ctx.database.get(V3_STICKER_TABLE, {})) as unknown as V3StickerRow[];
  } catch (cause) {
    throw new Error(`无法读取 v3 表 ${V3_STICKER_TABLE}: ${messageOf(cause)}`);
  }

  const candidates = rows.filter((row) => {
    if (!options.channelMatch || (options.includeUnsourced && !row.source.channelId)) return true;
    if (!options.channelMatch) return true;
    return (
      row.source.platform === options.channelMatch.platform && row.source.channelId === options.channelMatch.channelId
    );
  });
  const selected = options.limit === undefined ? candidates : candidates.slice(0, options.limit);
  stats.total = selected.length;

  for (const row of selected) {
    try {
      const filePath = options.sourceDir ? join(options.sourceDir, basename(row.filePath)) : row.filePath;
      const bytes = new Uint8Array(await readFile(filePath));
      const mediaType = detectImageMediaType(bytes);
      if (!mediaType) throw new Error("unsupported image");
      const contentId = sha256Hex(bytes);
      const existing = await options.store.get(options.scopeKey, contentId);
      if (existing) {
        stats.duplicate += 1;
        continue;
      }
      if (options.dryRun) {
        stats.imported += 1;
        continue;
      }
      const result = await options.store.save({
        scopeKey: options.scopeKey,
        bytes,
        mediaType,
        category: row.category,
        source: v3Source(row),
      });
      if (result.status === "created") stats.imported += 1;
      else stats.duplicate += 1;
    } catch (cause) {
      stats.failed += 1;
      stats.failedItems.push(`${row.id ?? row.filePath}: ${messageOf(cause)}`);
    }
  }
  return stats;
}

export async function migrateScope(options: MigrateScopeOptions): Promise<MigrationResult> {
  const stats = emptyMigrationStats();
  const rows = await options.store.listByScopeKey(options.fromScopeKey);
  const selected = options.limit === undefined ? rows : rows.slice(0, options.limit);
  stats.total = selected.length;
  let failed = false;

  for (const row of selected) {
    try {
      const bytes = await options.store.readBytes(row);
      const existing = await options.store.get(options.toScopeKey, row.id);
      if (existing) {
        stats.duplicate += 1;
        continue;
      }
      const result = await options.store.copyToScope(options.fromScopeKey, options.toScopeKey, bytes, {
        id: `${options.fromScopeKey}:${row.id}`,
        contentId: row.id,
        scopeKey: options.fromScopeKey,
        category: row.category,
        mime: row.mime,
        size: row.size,
        source: row.source,
        usageCount: row.usageCount,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      });
      if (result.status === "created") stats.imported += 1;
      else stats.duplicate += 1;
    } catch (cause) {
      failed = true;
      stats.failed += 1;
      stats.failedItems.push(`${row.id}: ${messageOf(cause)}`);
    }
  }

  if (options.removeSource && !failed && stats.imported > 0) {
    stats.removedSource = await options.store.removeScopeRows(options.fromScopeKey);
  }
  return stats;
}

function v3Source(row: V3StickerRow): StickerSource {
  return {
    kind: "v3",
    platform: row.source.platform,
    channelId: row.source.channelId,
    userId: row.source.userId,
    messageId: row.source.messageId,
    v3Id: row.id,
  };
}

function emptyMigrationStats(): MigrationResult {
  return {
    total: 0,
    imported: 0,
    duplicate: 0,
    failed: 0,
    failedItems: [],
    removedSource: 0,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
