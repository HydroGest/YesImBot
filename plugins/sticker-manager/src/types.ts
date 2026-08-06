import type { ChannelScope } from "koishi-plugin-yesimbot";

export type StickerScopeMode = "global" | "channel";

export interface StickerConfig {
  scope: StickerScopeMode;
  storagePath: string;
  classificationModel: string;
  classificationPrompt: string;
  maxImportFileBytes: number;
  tagMode: boolean;
  fuzzyTagMatch: boolean;
  stickerElement: boolean;
}

export type StickerSourceKind = "steal" | "import" | "v3" | "migrate";

export interface StickerSource {
  kind: StickerSourceKind;
  platform?: string;
  channelId?: string;
  userId?: string;
  messageId?: string;
  v3Id?: string;
}

export interface StickerRow {
  id: string;
  contentId: string;
  scopeKey: string;
  category: string;
  tags: string[];
  mime: string;
  size: number;
  source: StickerSource;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StickerProjection {
  id: string;
  category: string;
  tags: string[];
  mime: string;
  size: number;
  source: StickerSource;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CategorySummary {
  category: string;
  count: number;
}

export interface TagSummary {
  tag: string;
  count: number;
}

export interface StickerQuery {
  category?: string;
  keyword?: string;
  tags?: readonly string[];
  matchAllTags?: boolean;
  limit?: number;
}

export interface SaveStickerInput {
  scopeKey: string;
  bytes: Uint8Array;
  mediaType: string;
  category: string;
  tags?: readonly string[];
  source: StickerSource;
}

export type SaveStickerResult =
  | { status: "created"; sticker: StickerProjection }
  | { status: "duplicate"; sticker: StickerProjection };

export interface CleanupResult {
  orphanFiles: number;
  missingFiles: string[];
  deletedOrphanFiles: number;
}

export interface ImportStats {
  total: number;
  success: number;
  duplicate: number;
  failed: number;
  failedItems: string[];
}

export interface MigrationResult {
  total: number;
  imported: number;
  duplicate: number;
  failed: number;
  failedItems: string[];
  removedSource: number;
}

export function scopeKeyFor(scope: ChannelScope, config: Pick<StickerConfig, "scope">): string {
  if (config.scope === "global") return "global";
  return scope.type === "shared"
    ? `shared:${scope.platform}:${scope.channelId}`
    : `direct:${scope.platform}:${scope.selfId}:${scope.channelId}`;
}

export function normalizeCategory(value: string): string {
  const cleaned = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code === 32 || (code >= 33 && code <= 126) || code >= 128) return character;
      return " ";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 64 ? cleaned.slice(0, 64).trim() : cleaned;
}

export function normalizeTags(value: readonly string[] | undefined): string[] {
  const tags = new Set<string>();
  for (const raw of value ?? []) {
    const tag = normalizeCategory(raw).slice(0, 32).trim();
    if (tag) tags.add(tag);
    if (tags.size >= 8) break;
  }
  return [...tags];
}

export function toProjection(row: StickerRow): StickerProjection {
  return {
    id: row.contentId,
    category: row.category,
    tags: row.tags ?? [],
    mime: row.mime,
    size: row.size,
    source: row.source,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}
