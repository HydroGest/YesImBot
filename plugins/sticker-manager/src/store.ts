import type { Context, Field, Types } from "koishi";

import { sha256Hex, type StickerFileStore } from "./files.js";
import {
  normalizeCategory,
  normalizeTags,
  toProjection,
  type CategorySummary,
  type CleanupResult,
  type SaveStickerInput,
  type SaveStickerResult,
  type StickerProjection,
  type StickerQuery,
  type StickerRow,
  type TagSummary,
} from "./types.js";
export const STICKER_TABLE = "yesimbot_sticker";
const STICKER_FIELDS = {
  id: "string(512)",
  contentId: "string(64)",
  scopeKey: "string(512)",
  category: "string(128)",
  tags: { type: "list", initial: [] },
  mime: "string(128)",
  size: "unsigned",
  source: "json",
  usageCount: "unsigned",
  lastUsedAt: { type: "string", nullable: true, initial: null },
  createdAt: "string",
  updatedAt: "string",
} satisfies Field.Extension<StickerRow, Types>;
const registeredModels = new WeakSet<object>();
type StoreModel = Pick<Context["model"], "extend" | "get" | "create" | "set" | "remove">;
declare module "koishi" {
  interface Tables {
    [STICKER_TABLE]: StickerRow;
  }
}
export class StickerStore {
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly model: StoreModel,
    private readonly files: StickerFileStore,
  ) {}

  public ensure(): Promise<void> {
    return this.files.ensure();
  }

  public save(input: SaveStickerInput): Promise<SaveStickerResult> {
    return this.mutate(async () => {
      const contentId = sha256Hex(input.bytes);
      const now = new Date().toISOString();
      const existing = await this.findRow(input.scopeKey, contentId);
      if (existing) {
        const mergedTags = normalizeTags([...(existing.tags ?? []), ...(input.tags ?? [])]);
        if (mergedTags.length > 0 && mergedTags.join("\u0000") !== (existing.tags ?? []).join("\u0000")) {
          await this.model.set(STICKER_TABLE, { id: existing.id }, { tags: mergedTags, updatedAt: now });
          return { status: "duplicate", sticker: toProjection({ ...existing, tags: mergedTags }) };
        }
        return { status: "duplicate", sticker: toProjection(existing) };
      }

      const category = normalizeCategory(input.category) || "未分类";
      const row: StickerRow = {
        id: `${input.scopeKey}:${contentId}`,
        contentId,
        scopeKey: input.scopeKey,
        category,
        tags: normalizeTags(input.tags),
        mime: input.mediaType,
        size: input.bytes.byteLength,
        source: input.source,
        usageCount: 0,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      await this.files.write(input.bytes, contentId);
      try {
        await this.model.create(STICKER_TABLE, row);
      } catch (cause) {
        if (!(await this.isReferenced(contentId))) {
          await this.files.remove(contentId);
        }
        throw cause;
      }

      return { status: "created", sticker: toProjection(row) };
    });
  }

  public get(scopeKey: string, contentId: string): Promise<StickerProjection | null> {
    return this.mutate(async () => {
      const row = await this.findRow(scopeKey, contentId);
      return row ? toProjection(row) : null;
    });
  }

  public listCategories(scopeKey: string): Promise<CategorySummary[]> {
    return this.mutate(async () => {
      const rows = await this.rows(scopeKey);
      const counts = new Map<string, number>();
      for (const row of rows) {
        counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
      }
      return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((left, right) => left.category.localeCompare(right.category));
    });
  }

  public listTags(scopeKey: string): Promise<TagSummary[]> {
    return this.mutate(async () => {
      const rows = await this.rows(scopeKey);
      const counts = new Map<string, number>();
      for (const row of rows) {
        for (const tag of row.tags ?? []) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((left, right) => left.tag.localeCompare(right.tag));
    });
  }

  public search(scopeKey: string, query: StickerQuery = {}): Promise<StickerProjection[]> {
    return this.mutate(async () => {
      let rows = await this.rows(scopeKey);
      if (query.category) {
        rows = rows.filter((row) => row.category === query.category);
      }
      if (query.tags && query.tags.length > 0) {
        const tags = normalizeTags(query.tags);
        rows = rows.filter((row) => {
          const rowTags = new Set(row.tags ?? []);
          return query.matchAllTags ? tags.every((tag) => rowTags.has(tag)) : tags.some((tag) => rowTags.has(tag));
        });
      }
      if (query.keyword) {
        const keyword = query.keyword.toLowerCase();
        rows = rows.filter(
          (row) =>
            row.category.toLowerCase().includes(keyword) ||
            row.contentId.toLowerCase().includes(keyword) ||
            (row.tags ?? []).some((tag) => tag.toLowerCase().includes(keyword)),
        );
      }
      rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 50) : 20;
      return rows.slice(0, limit).map(toProjection);
    });
  }

  public random(scopeKey: string, category?: string): Promise<StickerProjection | null> {
    return this.mutate(async () => {
      let rows = await this.rows(scopeKey);
      if (category) rows = rows.filter((row) => row.category === category);
      if (rows.length === 0) return null;
      return toProjection(rows[Math.floor(Math.random() * rows.length)]!);
    });
  }

  public listCategory(scopeKey: string, category: string): Promise<StickerProjection[]> {
    return this.mutate(async () => {
      const rows = (await this.rows(scopeKey)).filter((row) => row.category === category).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return rows.map(toProjection);
    });
  }

  public renameCategory(scopeKey: string, oldName: string, newName: string): Promise<number> {
    return this.mutate(async () => {
      const target = normalizeCategory(newName);
      if (!target) throw new Error("新分类名不能为空");
      const result = await this.model.set(STICKER_TABLE, { scopeKey, category: oldName }, { category: target, updatedAt: new Date().toISOString() });
      return result.matched ?? 0;
    });
  }

  public mergeCategories(scopeKey: string, source: string, target: string): Promise<number> {
    return this.mutate(async () => {
      const normalizedTarget = normalizeCategory(target);
      if (!normalizedTarget) throw new Error("目标分类名不能为空");
      const result = await this.model.set(STICKER_TABLE, { scopeKey, category: source }, { category: normalizedTarget, updatedAt: new Date().toISOString() });
      return result.matched ?? 0;
    });
  }

  public moveSticker(scopeKey: string, contentId: string, category: string): Promise<number> {
    return this.mutate(async () => {
      const target = normalizeCategory(category);
      if (!target) throw new Error("分类名不能为空");
      const result = await this.model.set(STICKER_TABLE, { scopeKey, contentId }, { category: target, updatedAt: new Date().toISOString() });
      if (result.matched === 0) throw new Error("未找到该表情包");
      return result.matched ?? 0;
    });
  }

  public updateClassification(scopeKey: string, contentId: string, category: string, tags?: readonly string[]): Promise<void> {
    return this.mutate(async () => {
      const row = await this.findRow(scopeKey, contentId);
      if (!row) throw new Error("未找到该表情包");
      const target = normalizeCategory(category) || "未分类";
      await this.model.set(STICKER_TABLE, { scopeKey, contentId }, { category: target, tags: normalizeTags(tags), updatedAt: new Date().toISOString() });
    });
  }

  public deleteCategory(scopeKey: string, category: string): Promise<{ removed: number; files: number }> {
    return this.mutate(async () => {
      const rows = await this.model.get(STICKER_TABLE, { scopeKey, category });
      const result = await this.model.remove(STICKER_TABLE, { scopeKey, category });
      const contentIds = [...new Set(rows.map((row) => row.contentId))];
      let files = 0;
      for (const contentId of contentIds) {
        if (!(await this.isReferenced(contentId))) {
          await this.files.remove(contentId);
          files += 1;
        }
      }
      return { removed: result.removed ?? 0, files };
    });
  }

  public markUsed(scopeKey: string, contentId: string): Promise<StickerProjection> {
    return this.mutate(async () => {
      const row = await this.findRow(scopeKey, contentId);
      if (!row) throw new Error("未找到该表情包");
      const now = new Date().toISOString();
      await this.model.set(STICKER_TABLE, { scopeKey, contentId }, { usageCount: row.usageCount + 1, lastUsedAt: now, updatedAt: now });
      return toProjection({ ...row, usageCount: row.usageCount + 1, lastUsedAt: now, updatedAt: now });
    });
  }

  public async readBytes(projection: StickerProjection): Promise<Uint8Array> {
    return this.files.read(projection.id);
  }

  public listByScopeKey(scopeKey: string): Promise<StickerProjection[]> {
    return this.mutate(async () => (await this.rows(scopeKey)).map(toProjection));
  }

  public copyToScope(sourceScopeKey: string, targetScopeKey: string, bytes: Uint8Array, row: StickerRow): Promise<SaveStickerResult> {
    return this.save({
      scopeKey: targetScopeKey,
      bytes,
      mediaType: row.mime,
      category: row.category,
      tags: row.tags ?? [],
      source: { ...row.source, kind: "migrate" },
    });
  }

  public removeScopeRows(scopeKey: string): Promise<number> {
    return this.mutate(async () => {
      const rows = await this.rows(scopeKey);
      const result = await this.model.remove(STICKER_TABLE, { scopeKey });
      const contentIds = [...new Set(rows.map((row) => row.contentId))];
      for (const contentId of contentIds) {
        if (!(await this.isReferenced(contentId))) {
          await this.files.remove(contentId);
        }
      }
      return result.removed ?? 0;
    });
  }

  public cleanup(): Promise<CleanupResult> {
    return this.mutate(async () => {
      const [rows, files] = await Promise.all([this.model.get(STICKER_TABLE, {}), this.files.list()]);
      const referenced = new Set(rows.map((row) => row.contentId));
      const orphanFiles = files.filter((name) => !referenced.has(name));
      let deletedOrphanFiles = 0;
      for (const name of orphanFiles) {
        await this.files.remove(name);
        deletedOrphanFiles += 1;
      }
      const missingFiles = (await Promise.all(rows.map(async (row) => ((await this.files.exists(row.contentId)) ? null : row.contentId)))).filter(
        (contentId): contentId is string => contentId !== null,
      );
      return { orphanFiles: orphanFiles.length, missingFiles, deletedOrphanFiles };
    });
  }

  private async findRow(scopeKey: string, contentId: string): Promise<StickerRow | null> {
    const rows = await this.model.get(STICKER_TABLE, { scopeKey, contentId });
    return rows[0] ?? null;
  }

  private async rows(scopeKey: string): Promise<StickerRow[]> {
    return this.model.get(STICKER_TABLE, { scopeKey });
  }

  private async isReferenced(contentId: string): Promise<boolean> {
    const rows = await this.model.get(STICKER_TABLE, { contentId });
    return rows.length > 0;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(operation, operation);
    this.mutationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
export function registerStickerModel(model: StoreModel): void {
  if (registeredModels.has(model)) return;
  registeredModels.add(model);
  model.extend(STICKER_TABLE, STICKER_FIELDS, { primary: "id" });
}
