import { h, type Command, type Context, type Session } from "koishi";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import { importDirectory, importEmojiHubTxt, importImageFile } from "./importers.js";
import { migrateScope, migrateV3 } from "./migrate.js";
import type { StickerStore } from "./store.js";
import {
  scopeKeyFor,
  type ImportStats,
  type MigrationResult,
  type StickerConfig,
  type StickerProjection,
} from "./types.js";

export interface StickerCommandDeps {
  ctx: Context;
  store: StickerStore;
  config: StickerConfig;
}

export function registerStickerCommands(deps: StickerCommandDeps): () => void {
  const { ctx, store, config } = deps;
  const disposers = new Set<() => unknown>();
  const track = (command: Command): void => {
    if (typeof command.dispose === "function") disposers.add(() => command.dispose());
  };

  track(ctx.command("yesimbot.sticker", "表情包管理", { authority: 2 }));

  track(
    ctx.command("yesimbot.sticker.list", "列出表情包分类", { authority: 2 }).action(async ({ session }) => {
      const scope = scopeOf(session);
      if (!scope) return "无法获取当前频道信息";
      const categories = await store.listCategories(scopeKeyFor(scope, config));
      if (categories.length === 0) return "暂无表情包分类";
      return categories.map((item) => `- ${item.category} (${item.count} 个)`).join("\n");
    }),
  );

  track(
    ctx
      .command("yesimbot.sticker.get <category> [index:posint]", "获取指定分类的表情包", { authority: 2 })
      .option("all", "-a 发送该分类下所有表情包")
      .option("delay", "-d [delay:posint] 发送所有表情包时的延时(ms)，默认为 500")
      .action(async ({ session, options }, category, index) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!category) return "请提供分类名称";
        const scopeKey = scopeKeyFor(scope, config);
        const stickers = await store.listCategory(scopeKey, category);
        if (stickers.length === 0) return `分类 "${category}" 中没有表情包`;
        if (!session) return "无法获取当前会话";

        if (options?.all) {
          const delay = options.delay ?? 500;
          for (const sticker of stickers) {
            await sendSticker(session, scopeKey, store, sticker);
            await sleep(delay);
          }
          return `已发送分类 "${category}" 下所有 ${stickers.length} 个表情包`;
        }

        const sticker = index ? stickers[index - 1] : stickers[Math.floor(Math.random() * stickers.length)];
        if (!sticker) return `无效序号，该分类共有 ${stickers.length} 个表情包`;
        await sendSticker(session, scopeKey, store, sticker);
        return `ID: ${sticker.id}\n分类: ${sticker.category}`;
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.info <category>", "查看分类详情", { authority: 2 })
      .action(async ({ session }, category) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!category) return "请提供分类名称";
        const stickers = await store.listCategory(scopeKeyFor(scope, config), category);
        if (stickers.length === 0) return `分类 "${category}" 中没有表情包`;
        return `分类: ${category}\n数量: ${stickers.length}\n最新: ${new Date(stickers[0]!.createdAt).toLocaleString()}`;
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.add <category> <file>", "导入单张表情包", { authority: 3 })
      .action(async ({ session }, category, file) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!category || !file) return "请提供分类和文件路径";
        const stats = await importImageFile(
          {
            ctx,
            store,
            scopeKey: scopeKeyFor(scope, config),
            maxImportFileBytes: config.maxImportFileBytes,
          },
          file,
          category,
        );
        return formatImportStats(stats);
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.import <sourceDir>", "从目录批量导入表情包", { authority: 4 })
      .action(async ({ session }, sourceDir) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!sourceDir) return "请提供源文件夹路径";
        try {
          const stats = await importDirectory(
            {
              ctx,
              store,
              scopeKey: scopeKeyFor(scope, config),
              maxImportFileBytes: config.maxImportFileBytes,
            },
            sourceDir,
          );
          return formatImportStats(stats);
        } catch (cause) {
          return `导入失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.import.emojihub <category> <filePath>", "导入 emojihub-bili 格式 TXT", {
        authority: 4,
      })
      .action(async ({ session }, category, filePath) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!category || !filePath) return "请提供分类名称和 TXT 文件路径";
        try {
          const stats = await importEmojiHubTxt(
            {
              ctx,
              store,
              scopeKey: scopeKeyFor(scope, config),
              maxImportFileBytes: config.maxImportFileBytes,
            },
            filePath,
            category,
          );
          return formatImportStats(stats);
        } catch (cause) {
          return `导入失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.rename <oldName> <newName>", "重命名表情包分类", { authority: 3 })
      .action(async ({ session }, oldName, newName) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!oldName || !newName) return "请提供原分类名和新分类名";
        if (oldName === newName) return "新分类名不能与原分类名相同";
        try {
          const count = await store.renameCategory(scopeKeyFor(scope, config), oldName, newName);
          return `已将分类 "${oldName}" 重命名为 "${newName}"，共更新 ${count} 个表情包`;
        } catch (cause) {
          return `重命名失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.merge <sourceCategory> <targetCategory>", "合并两个表情包分类", { authority: 3 })
      .action(async ({ session }, sourceCategory, targetCategory) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!sourceCategory || !targetCategory) return "请提供源分类和目标分类";
        if (sourceCategory === targetCategory) return "源分类和目标分类不能相同";
        try {
          const count = await store.mergeCategories(scopeKeyFor(scope, config), sourceCategory, targetCategory);
          return `已将分类 "${sourceCategory}" 合并到 "${targetCategory}"，共移动 ${count} 个表情包`;
        } catch (cause) {
          return `合并失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.move <stickerId> <newCategory>", "移动表情包到新分类", { authority: 3 })
      .action(async ({ session }, stickerId, newCategory) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!stickerId || !newCategory) return "请提供表情包 ID 和目标分类";
        try {
          await store.moveSticker(scopeKeyFor(scope, config), stickerId, newCategory);
          return `已将表情包 ${stickerId} 移动到分类 "${newCategory}"`;
        } catch (cause) {
          return `移动失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.delete <category>", "删除表情包分类", { authority: 3 })
      .option("force", "-f 强制删除，不确认")
      .action(async ({ session, options }, category) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        if (!category) return "请提供要删除的分类名";
        const scopeKey = scopeKeyFor(scope, config);
        const stickers = await store.listCategory(scopeKey, category);
        if (stickers.length === 0) return `分类 "${category}" 中没有表情包`;
        if (!session) return "无法获取当前会话";
        if (!options?.force) {
          await session.send(
            `确认删除分类 "${category}" 吗？该分类下有 ${stickers.length} 个表情包。回复“确认删除”继续。`,
          );
          const response = await session.prompt(60_000);
          if (response !== "确认删除") return "操作已取消";
        }
        const result = await store.deleteCategory(scopeKey, category);
        return `已删除分类 "${category}"，移除 ${result.removed} 条记录和 ${result.files} 个文件`;
      }),
  );

  track(
    ctx.command("yesimbot.sticker.cleanup", "修复孤儿文件和损坏记录", { authority: 4 }).action(async () => {
      const result = await store.cleanup();
      return `清理完成：删除孤儿文件 ${result.deletedOrphanFiles}，发现缺失文件 ${result.missingFiles.length} 个`;
    }),
  );

  track(
    ctx
      .command("yesimbot.sticker.migrate-v3", "从 v3 sticker-manager 迁移", { authority: 4 })
      .option("source", "<source> 旧 sticker 文件目录")
      .option("includeUnsourced", "-i 包含没有频道来源的旧记录")
      .option("limit", "<limit> 最多迁移的记录数")
      .option("dryRun", "-n 仅预览，不写入")
      .action(async ({ session, options }) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        const scopeKey = scopeKeyFor(scope, config);
        try {
          const stats = await migrateV3({
            ctx,
            store,
            scopeKey,
            channelMatch:
              config.scope === "channel" ? { platform: scope.platform, channelId: scope.channelId } : undefined,
            includeUnsourced: options?.includeUnsourced === true,
            sourceDir: stringOption(options, "source"),
            limit: numberOption(options, "limit"),
            dryRun: options?.dryRun === true,
          });
          return formatMigrationStats(stats);
        } catch (cause) {
          return `迁移失败: ${messageOf(cause)}`;
        }
      }),
  );

  track(
    ctx
      .command("yesimbot.sticker.migrate", "在 hidden 与 active scope 间迁移", { authority: 4 })
      .option("from", "<from> 来源：global 或 channel")
      .option("to", "<to> 目标：global 或 channel")
      .option("removeSource", "-r 迁移成功后删除来源记录")
      .option("limit", "<limit> 最多迁移的记录数")
      .action(async ({ session, options }) => {
        const scope = scopeOf(session);
        if (!scope) return "无法获取当前频道信息";
        let fromScopeKey: string;
        let toScopeKey: string;
        try {
          fromScopeKey = resolveScopeOption(options?.from, scope, scopeKeyFor(scope, config));
          toScopeKey = resolveScopeOption(options?.to, scope, scopeKeyFor(scope, config));
        } catch (cause) {
          return `迁移失败: ${messageOf(cause)}`;
        }
        if (fromScopeKey === toScopeKey) return "来源和目标 scope 相同，无需迁移";
        try {
          const stats = await migrateScope({
            store,
            fromScopeKey,
            toScopeKey,
            removeSource: options?.removeSource === true,
            limit: numberOption(options, "limit"),
          });
          return formatMigrationStats(stats);
        } catch (cause) {
          return `迁移失败: ${messageOf(cause)}`;
        }
      }),
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {}
    }
    disposers.clear();
  };
}

async function sendSticker(
  session: Session,
  scopeKey: string,
  store: StickerStore,
  sticker: StickerProjection,
): Promise<void> {
  const bytes = await store.readBytes(sticker);
  const dataUrl = `data:${sticker.mime};base64,${Buffer.from(bytes).toString("base64")}`;
  await session.send([h.image(dataUrl)]);
  await store.markUsed(scopeKey, sticker.id);
}

function scopeOf(session: Session | undefined): ChannelScope | null {
  if (!session?.platform || !session.selfId || !session.channelId) return null;
  return {
    type: session.isDirect ? "direct" : "shared",
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
  };
}

function resolveScopeOption(value: unknown, scope: ChannelScope, currentScopeKey: string): string {
  if (value === undefined) return currentScopeKey;
  if (value === "global") return "global";
  if (value === "channel") return scopeKeyFor(scope, { scope: "channel" });
  throw new Error("scope 只能是 global 或 channel");
}

function formatImportStats(stats: ImportStats): string {
  const lines = [`总数: ${stats.total}`, `成功: ${stats.success}`, `重复: ${stats.duplicate}`, `失败: ${stats.failed}`];
  if (stats.failedItems.length > 0) {
    lines.push("", `失败项: ${stats.failedItems.slice(0, 10).join("\n")}`);
  }
  return lines.join("\n");
}

function formatMigrationStats(stats: MigrationResult): string {
  const lines = [
    `总数: ${stats.total}`,
    `导入: ${stats.imported}`,
    `重复: ${stats.duplicate}`,
    `失败: ${stats.failed}`,
  ];
  if (stats.removedSource > 0) lines.push(`删除来源记录: ${stats.removedSource}`);
  if (stats.failedItems.length > 0) {
    lines.push("", `失败项: ${stats.failedItems.slice(0, 10).join("\n")}`);
  }
  return lines.join("\n");
}

function stringOption(options: unknown, key: string): string | undefined {
  const value = (options as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOption(options: unknown, key: string): number | undefined {
  const value = (options as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
