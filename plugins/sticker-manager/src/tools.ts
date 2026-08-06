import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import type { AssetStore, ChannelScope } from "koishi-plugin-yesimbot";

import type { StickerClassifier } from "./classifier.js";
import { detectImageMediaType, sha256Hex } from "./files.js";
import { prepareStaticGif } from "./frames.js";
import type { StickerSender } from "./sender.js";
import type { StickerStore } from "./store.js";
import { normalizeCategory, normalizeTags, scopeKeyFor, type StickerConfig, type StickerProjection } from "./types.js";

interface StealStickerInput {
  asset_id: string;
  category?: string;
}

interface SendStickerInput {
  sticker_id?: string;
  category?: string;
  index?: number;
  tags?: string[];
}

interface SearchStickerInput {
  category?: string;
  keyword?: string;
  tags?: string[];
  limit?: number;
}

type ToolResult = { ok: true; message: string; [key: string]: unknown } | { ok: false; error: string };

export interface StickerToolsOptions {
  store: StickerStore;
  classifier: StickerClassifier;
  sender: StickerSender;
  assets: AssetStore;
  scope: ChannelScope;
  config: StickerConfig;
}

export function createStickerTools(options: StickerToolsOptions): AgentTool[] {
  const { store, classifier, sender, assets, scope, config } = options;
  const scopeKey = scopeKeyFor(scope, config);

  const stealTool: AgentTool<StealStickerInput, ToolResult> = {
    name: "sticker_steal",
    description: [
      "收藏当前消息中的一张表情包图片。",
      "asset_id 必须来自消息里的 [图片：asset://<id>]，只传 32 位十六进制 id，不要拼接或猜测。",
      "category 可选；不提供时会使用视觉模型自动分类，失败则归入“未分类”。",
      ...(config.tagMode ? ["实验性 tag 模式开启时，收藏后会按分类自动打 tag。"] : []),
    ].join("\n"),
    inputSchema: jsonSchema<StealStickerInput>({
      type: "object",
      properties: {
        asset_id: { type: "string", description: "当前消息图片的 32 位 asset id" },
        category: { type: "string", description: "可选分类名" },
      },
      required: ["asset_id"],
      additionalProperties: false,
    }),
    execute: async ({ asset_id, category }, execution) => {
      const id = asset_id.replace(/^asset:\/\//, "");
      if (!/^[a-f0-9]{32}$/.test(id)) return { ok: false, error: "invalid_asset_id" };
      let bytes: Uint8Array;
      try {
        bytes = await assets.get(id);
      } catch {
        return { ok: false, error: "asset_not_found" };
      }
      const mediaType = detectImageMediaType(bytes);
      if (!mediaType) return { ok: false, error: "unsupported_image" };
      const contentId = sha256Hex(bytes);
      const existing = await store.get(scopeKey, contentId);
      if (existing) {
        return {
          ok: true,
          status: "duplicate",
          id: existing.id,
          category: existing.category,
          tags: existing.tags,
          message: `表情包已存在于分类：${existing.category}`,
        };
      }

      const categories = (await store.listCategories(scopeKey)).map((item) => item.category);
      const autoClassified = category
        ? undefined
        : await classifier.classify({
            bytes,
            mediaType,
            categories,
            signal: execution.abortSignal,
          });
      const classified = category ? normalizeCategory(category) : (autoClassified?.category ?? "未分类");

      const saved = await store.save({
        scopeKey,
        bytes,
        mediaType,
        category: classified,
        tags: config.tagMode ? normalizeTags([classified, ...(autoClassified?.tags ?? [])]) : undefined,
        source: {
          kind: "steal",
          platform: scope.platform,
          channelId: scope.channelId,
        },
      });
      return {
        ok: true,
        status: saved.status,
        id: saved.sticker.id,
        category: saved.sticker.category,
        tags: saved.sticker.tags,
        message:
          saved.status === "duplicate"
            ? `表情包已存在于分类：${saved.sticker.category}`
            : `已收藏到分类：${saved.sticker.category}`,
      };
    },
  };

  const sendTool: AgentTool<SendStickerInput, ToolResult> = {
    name: "sticker_send",
    description: [
      "发送一个已收藏的表情包。",
      "可用 sticker_categories 和 sticker_search 查询；sticker_id 优先，也可按 category 随机或按 index 指定。",
      ...(config.sendStaticAsGif ? ["静态图片会自动转成单帧 GIF 后发送。"] : []),
      ...(config.tagMode
        ? [
            `也可仅传 tags 选择多个标签，并从匹配分范围内的表情包中随机发送。${
              config.fuzzyTagMatch ? "tag 默认支持模糊匹配。" : ""
            }`,
          ]
        : []),
    ].join("\n"),
    inputSchema: jsonSchema<SendStickerInput>({
      type: "object",
      properties: {
        sticker_id: { type: "string", description: "sticker_search 返回的 id" },
        category: { type: "string", description: "分类名" },
        index: { type: "integer", minimum: 1, description: "分类内 1-based 序号" },
        ...(config.tagMode
          ? {
              tags: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
                description: config.fuzzyTagMatch
                  ? "实验性标签列表，支持模糊匹配；从匹配分范围内的表情包中随机发送"
                  : "实验性标签列表，从匹配分范围内的表情包中随机发送",
              },
            }
          : {}),
      },
      additionalProperties: false,
    }),
    execute: async ({ sticker_id, category, index, tags }) => {
      try {
        let sticker: StickerProjection;
        if (sticker_id) {
          const found = await store.get(scopeKey, sticker_id);
          if (!found) return { ok: false, error: "sticker_not_found" };
          sticker = found;
        } else if (index !== undefined) {
          const found = await store.search(scopeKey, { category, limit: 100 });
          const selected = found[index - 1];
          if (!selected) return { ok: false, error: "sticker_index_out_of_range" };
          sticker = selected;
        } else if (tags && tags.length > 0) {
          const tagged = await pickBestTaggedSticker(
            store,
            scopeKey,
            tags,
            category,
            config.fuzzyTagMatch,
            config.tagRandomRange,
          );
          if (!tagged) return { ok: false, error: "sticker_not_found" };
          sticker = tagged;
        } else {
          const found = await store.random(scopeKey, category);
          if (!found) return { ok: false, error: "sticker_not_found" };
          sticker = found;
        }

        const bytes = await store.readBytes(sticker);
        const prepared = prepareStaticGif(bytes, sticker.mime, config.sendStaticAsGif);
        await sender.send({ bytes: prepared.bytes, mediaType: prepared.mediaType });
        await store.markUsed(scopeKey, sticker.id);
        return {
          ok: true,
          id: sticker.id,
          category: sticker.category,
          tags: sticker.tags,
          message:
            tags && tags.length > 0
              ? `已按标签 ${tags.join("、")} 发送 ${sticker.category} 分类的表情包`
              : `已发送 ${sticker.category} 分类的表情包`,
        };
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
      }
    },
  };

  const categoriesTool: AgentTool<Record<string, never>, ToolResult> = {
    name: "sticker_categories",
    description: "列出当前可见的表情包分类和每类数量，用于选择 sticker_steal 或 sticker_send 的分类。",
    inputSchema: jsonSchema<Record<string, never>>({
      type: "object",
      additionalProperties: false,
    }),
    execute: async () => {
      const categories = await store.listCategories(scopeKey);
      return { ok: true, categories, message: categories.length ? "已返回分类列表" : "暂无分类" };
    },
  };

  const tagsTool = config.tagMode
    ? ({
        name: "sticker_tags",
        description: "实验性：列出当前可见表情包的标签和数量，用于 sticker_send 按标签发送。",
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          additionalProperties: false,
        }),
        execute: async () => {
          const tags = await store.listTags(scopeKey);
          return { ok: true, tags, message: tags.length ? "已返回标签列表" : "暂无标签" };
        },
      } satisfies AgentTool<Record<string, never>, ToolResult>)
    : null;

  const searchTool: AgentTool<SearchStickerInput, ToolResult> = {
    name: "sticker_search",
    description: [
      "搜索当前可见的表情包，返回紧凑 id 列表，供 sticker_send 使用。",
      'sticker_search 只用于查询；确定目标后调用 sticker_send，或在启用 sticker 元素时输出 <sticker id="..."/>。',
      "绝不能把返回的 id 拼成 artifact:// 等资源 URI。",
      ...(config.tagMode ? ["实验性 tag 模式开启时，可按 tags 过滤。"] : []),
    ].join("\n"),
    inputSchema: jsonSchema<SearchStickerInput>({
      type: "object",
      properties: {
        category: { type: "string", description: "按分类过滤" },
        keyword: { type: "string", description: "按分类名或 id 关键词过滤" },
        ...(config.tagMode
          ? {
              tags: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
                description: "实验性标签列表，匹配任一标签即可",
              },
            }
          : {}),
        limit: { type: "integer", minimum: 1, maximum: 50, description: "返回数量上限" },
      },
      additionalProperties: false,
    }),
    execute: async (query) => {
      const stickers = await store.search(scopeKey, query);
      return {
        ok: true,
        stickers: stickers.map((sticker) => ({
          id: sticker.id,
          category: sticker.category,
          tags: sticker.tags,
          mime: sticker.mime,
          size: sticker.size,
          usageCount: sticker.usageCount,
        })),
        message: stickers.length ? "已返回搜索结果" : "没有匹配的表情包",
      };
    },
  };

  return [stealTool, sendTool, categoriesTool, searchTool, ...(tagsTool ? [tagsTool] : [])];
}

export async function pickBestTaggedSticker(
  store: StickerStore,
  scopeKey: string,
  tags: readonly string[],
  category?: string,
  fuzzyTagMatch = true,
  randomRange = 0,
): Promise<StickerProjection | null> {
  const normalized = normalizeTags(tags);
  if (normalized.length === 0) return null;
  const rows = await store.listByScopeKey(scopeKey);
  const scoped = category ? rows.filter((sticker) => sticker.category === category) : rows;
  const matches = scoped.filter((sticker) =>
    normalized.some((tag) => stickerMatches(sticker.tags, tag, fuzzyTagMatch)),
  );
  if (matches.length === 0) return null;
  const score = (sticker: StickerProjection): number =>
    normalized.reduce((count, tag) => count + (stickerMatches(sticker.tags, tag, fuzzyTagMatch) ? 1 : 0), 0);
  const best = Math.max(...matches.map(score));
  const threshold = Math.min(best, Math.max(0, randomRange));
  const candidates = matches.filter((sticker) => score(sticker) >= best - threshold);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function stickerMatches(tags: readonly string[], requested: string, fuzzyTagMatch: boolean): boolean {
  return tags.some((tag) => (fuzzyTagMatch ? fuzzyTagEquals(requested, tag) : tag === requested));
}

function fuzzyTagEquals(requested: string, stored: string): boolean {
  const left = requested.toLowerCase();
  const right = stored.toLowerCase();
  return left.length > 0 && (right.includes(left) || left.includes(right));
}
