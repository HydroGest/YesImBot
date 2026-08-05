import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import type { AssetStore, ChannelScope } from "koishi-plugin-yesimbot";

import type { StickerClassifier } from "./classifier.js";
import { detectImageMediaType } from "./files.js";
import type { StickerSender } from "./sender.js";
import type { StickerStore } from "./store.js";
import { normalizeCategory, scopeKeyFor, type StickerConfig, type StickerProjection } from "./types.js";

interface StealStickerInput {
  asset_id: string;
  category?: string;
}

interface SendStickerInput {
  sticker_id?: string;
  category?: string;
  index?: number;
}

interface SearchStickerInput {
  category?: string;
  keyword?: string;
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

      const categories = (await store.listCategories(scopeKey)).map((item) => item.category);
      const classified = category
        ? normalizeCategory(category)
        : ((await classifier.classify({
            bytes,
            mediaType,
            categories,
            signal: execution.abortSignal,
          })) ?? "未分类");

      const saved = await store.save({
        scopeKey,
        bytes,
        mediaType,
        category: classified,
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
    ].join("\n"),
    inputSchema: jsonSchema<SendStickerInput>({
      type: "object",
      properties: {
        sticker_id: { type: "string", description: "sticker_search 返回的 id" },
        category: { type: "string", description: "分类名" },
        index: { type: "integer", minimum: 1, description: "分类内 1-based 序号" },
      },
      additionalProperties: false,
    }),
    execute: async ({ sticker_id, category, index }) => {
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
        } else {
          const found = await store.random(scopeKey, category);
          if (!found) return { ok: false, error: "sticker_not_found" };
          sticker = found;
        }

        const bytes = await store.readBytes(sticker);
        await sender.send({ bytes, mediaType: sticker.mime });
        await store.markUsed(scopeKey, sticker.id);
        return {
          ok: true,
          id: sticker.id,
          category: sticker.category,
          message: `已发送 ${sticker.category} 分类的表情包`,
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

  const searchTool: AgentTool<SearchStickerInput, ToolResult> = {
    name: "sticker_search",
    description: "搜索当前可见的表情包，返回紧凑 id 列表，供 sticker_send 使用。",
    inputSchema: jsonSchema<SearchStickerInput>({
      type: "object",
      properties: {
        category: { type: "string", description: "按分类过滤" },
        keyword: { type: "string", description: "按分类名或 id 关键词过滤" },
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
          mime: sticker.mime,
          size: sticker.size,
          usageCount: sticker.usageCount,
        })),
        message: stickers.length ? "已返回搜索结果" : "没有匹配的表情包",
      };
    },
  };

  return [stealTool, sendTool, categoriesTool, searchTool];
}
