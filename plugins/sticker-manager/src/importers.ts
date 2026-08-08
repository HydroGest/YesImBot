import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Context } from "koishi";

import { detectImageMediaType, isSupportedImageFile } from "./files.js";
import type { StickerStore } from "./store.js";
import type { ImportStats, StickerSource } from "./types.js";

interface ImportImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImporterOptions {
  ctx: Context;
  store: StickerStore;
  scopeKey: string;
  maxImportFileBytes: number;
}

export async function importImageFile(options: ImporterOptions, filePath: string, category: string): Promise<ImportStats> {
  const stats = emptyStats();
  stats.total = 1;
  try {
    const image = await readLocalImage(filePath, options.maxImportFileBytes);
    const result = await options.store.save({
      scopeKey: options.scopeKey,
      bytes: image.bytes,
      mediaType: image.mediaType,
      category,
      source: { kind: "import" },
    });
    if (result.status === "created") stats.success += 1;
    else stats.duplicate += 1;
  } catch (cause) {
    stats.failed += 1;
    stats.failedItems.push(`${filePath}: ${messageOf(cause)}`);
  }
  return stats;
}

export async function importDirectory(options: ImporterOptions, sourceDir: string): Promise<ImportStats> {
  const stats = emptyStats();
  const subdirs = await listSubdirectories(sourceDir);
  if (subdirs.length === 0) throw new Error(`源目录下没有分类子目录: ${sourceDir}`);

  for (const subdir of subdirs) {
    const category = basename(subdir);
    const files = await listImageFiles(subdir);
    stats.total += files.length;
    for (const file of files) {
      const filePath = join(subdir, file);
      try {
        const image = await readLocalImage(filePath, options.maxImportFileBytes);
        const result = await options.store.save({
          scopeKey: options.scopeKey,
          bytes: image.bytes,
          mediaType: image.mediaType,
          category,
          source: { kind: "import" },
        });
        if (result.status === "created") stats.success += 1;
        else stats.duplicate += 1;
      } catch (cause) {
        stats.failed += 1;
        stats.failedItems.push(`${filePath}: ${messageOf(cause)}`);
      }
    }
  }
  return stats;
}

export async function importEmojiHubTxt(options: ImporterOptions, filePath: string, category: string): Promise<ImportStats> {
  const stats = emptyStats();
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (cause) {
    throw new Error(`无法读取文件: ${messageOf(cause)}`);
  }
  const urls = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  stats.total = urls.length;
  if (urls.length === 0) throw new Error("文件为空或没有有效 URL");

  for (const rawUrl of urls) {
    try {
      const url = normalizeEmojiHubUrl(rawUrl);
      const response = await options.ctx.http.file(url, { timeout: 15_000 });
      const bytes = new Uint8Array(Buffer.from(response.data));
      if (bytes.byteLength > options.maxImportFileBytes) {
        throw new Error(`文件超过 ${options.maxImportFileBytes} bytes`);
      }
      const mediaType = detectImageMediaType(bytes) ?? normalizeMediaType(response.type);
      if (!mediaType) throw new Error("unsupported image");
      const result = await options.store.save({ scopeKey: options.scopeKey, bytes, mediaType, category, source: { kind: "import" } });
      if (result.status === "created") stats.success += 1;
      else stats.duplicate += 1;
    } catch (cause) {
      stats.failed += 1;
      stats.failedItems.push(`${rawUrl}: ${messageOf(cause)}`);
    }
  }
  return stats;
}

function emptyStats(): ImportStats {
  return { total: 0, success: 0, duplicate: 0, failed: 0, failedItems: [] };
}

async function readLocalImage(filePath: string, maxBytes: number): Promise<ImportImage> {
  const bytes = new Uint8Array(await readFile(filePath));
  if (bytes.byteLength > maxBytes) throw new Error(`文件超过 ${maxBytes} bytes`);
  const mediaType = detectImageMediaType(bytes);
  if (!mediaType) throw new Error("unsupported image");
  return { bytes, mediaType };
}

async function listSubdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
}

async function listImageFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && isSupportedImageFile(entry.name)).map((entry) => entry.name);
}

function normalizeEmojiHubUrl(rawUrl: string): string {
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) return rawUrl;
  if (rawUrl.startsWith("https:https://")) return rawUrl.slice("https:".length);
  if (rawUrl.startsWith("/bfs/")) return `https://i0.hdslb.com${rawUrl}`;
  if (rawUrl.startsWith("bfs/")) return `https://i0.hdslb.com/${rawUrl}`;
  if (rawUrl.startsWith("/meme/")) return `https://memes.none.bot${rawUrl}`;
  if (rawUrl.startsWith("meme/")) return `https://memes.none.bot/${rawUrl}`;
  return `https://i0.hdslb.com/bfs/${rawUrl}`;
}

function normalizeMediaType(value: string | undefined): string | undefined {
  const type = value?.split(";")[0]?.trim().toLowerCase();
  return type?.startsWith("image/") ? type : undefined;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export type { StickerSource };
