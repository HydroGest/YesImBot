import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Context, Field, Types } from "koishi";

import { detectImageMediaType, sha256Hex } from "./files.js";
import type { StickerStore } from "./store.js";
import type { MigrationResult, StickerSource } from "./types.js";

const V3_STICKER_TABLE = "yesimbot.stickers";

const V3_STICKER_FIELDS = {
  id: "string(64)",
  category: "string(255)",
  filePath: "string(255)",
  source: "json",
  createdAt: "timestamp",
} satisfies Field.Extension<V3StickerRow, Types>;

export interface MigrateV3Options {
  ctx: Context;
  store: StickerStore;
  scopeKey: string;
  channelMatch?: { platform: string; channelId: string };
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

interface V3StickerSource {
  platform?: string;
  channelId?: string;
  userId?: string;
  messageId?: string;
}

interface V3StickerRow {
  id?: string;
  category?: string;
  filePath?: string;
  source?: V3StickerSource | string | null;
  createdAt?: Date | string | number;
}

declare module "koishi" {
  interface Tables {
    [V3_STICKER_TABLE]: V3StickerRow;
  }
}

export async function migrateV3(options: MigrateV3Options): Promise<MigrationResult> {
  const stats = emptyMigrationStats();
  let rows: V3StickerRow[];
  try {
    registerV3StickerModel(options.ctx.model);
    rows = (await options.ctx.database.get(V3_STICKER_TABLE, {})) as unknown as V3StickerRow[];
  } catch (error) {
    throw new Error(`无法读取 v3 表 ${V3_STICKER_TABLE}: ${messageOf(error)}`);
  }

  const candidates = rows.filter((row) => {
    const source = normalizeV3Source(row.source);
    if (!options.channelMatch) return true;
    if (options.includeUnsourced && !source.channelId) return true;
    return source.platform === options.channelMatch.platform && source.channelId === options.channelMatch.channelId;
  });
  const selected = options.limit === undefined ? candidates : candidates.slice(0, options.limit);
  stats.total = selected.length;

  for (const row of selected) {
    try {
      const oldFilePath = row.filePath;
      if (!oldFilePath) throw new Error("missing v3 filePath");
      const filePath = options.sourceDir ? path.join(options.sourceDir, path.basename(oldFilePath)) : oldFilePath;
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
      const result = await options.store.save({ scopeKey: options.scopeKey, bytes, mediaType, category: row.category ?? "", source: v3Source(row) });
      if (result.status === "created") stats.imported += 1;
      else stats.duplicate += 1;
    } catch (error) {
      stats.failed += 1;
      stats.failedItems.push(`${row.id ?? row.filePath}: ${messageOf(error)}`);
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
        tags: row.tags ?? [],
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
    } catch (error) {
      failed = true;
      stats.failed += 1;
      stats.failedItems.push(`${row.id}: ${messageOf(error)}`);
    }
  }

  if (options.removeSource && !failed && stats.imported > 0) {
    stats.removedSource = await options.store.removeScopeRows(options.fromScopeKey);
  }
  return stats;
}

function registerV3StickerModel(model: Pick<Context["model"], "extend">): void {
  model.extend(V3_STICKER_TABLE, V3_STICKER_FIELDS, { primary: "id" });
}

function v3Source(row: V3StickerRow): StickerSource {
  const source = normalizeV3Source(row.source);
  return { kind: "v3", platform: source.platform, channelId: source.channelId, userId: source.userId, messageId: source.messageId, v3Id: row.id };
}

function normalizeV3Source(source: V3StickerRow["source"]): V3StickerSource {
  if (typeof source === "string") {
    try {
      return normalizeV3Source(JSON.parse(source));
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object") return {};
  return { platform: stringOf(source.platform), channelId: stringOf(source.channelId), userId: stringOf(source.userId), messageId: stringOf(source.messageId) };
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function emptyMigrationStats(): MigrationResult {
  return { total: 0, imported: 0, duplicate: 0, failed: 0, failedItems: [], removedSource: 0 };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
