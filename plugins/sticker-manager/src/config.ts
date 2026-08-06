import { Schema } from "koishi";

import type { StickerConfig } from "./types.js";

export const DEFAULT_CLASSIFICATION_PROMPT = [
  "请对以下表情包进行分类，已有分类：[{{categories}}]。",
  "选择最匹配的分类或创建新类别。只返回分类名称。",
  "分类应基于可能的使用语境，避免模糊不清的名称。",
  "若不确定，请思考此表情包的具体使用场景后再分类。",
].join("");

export const StickerConfigSchema: Schema<StickerConfig> = Schema.object({
  scope: Schema.union([Schema.const("global"), Schema.const("channel")])
    .default("global")
    .description("sticker 可见范围：global 为全局库，channel 为按频道隔离"),
  storagePath: Schema.path({ filters: ["directory"], allowCreate: true })
    .default("data/yesimbot/sticker-manager")
    .description("sticker 文件存储目录"),
  classificationModel: Schema.dynamic("registry.chatModels")
    .default("")
    .description("用于表情分类的模型；留空则尝试当前默认聊天模型"),
  classificationPrompt: Schema.string()
    .role("textarea", { rows: [2, 5] })
    .default(DEFAULT_CLASSIFICATION_PROMPT)
    .description("分类提示词模板，可使用 {{categories}} 占位符"),
  maxImportFileBytes: Schema.number()
    .min(1024 * 1024)
    .default(10 * 1024 * 1024)
    .description("单张导入图片的最大字节数"),
  tagMode: Schema.boolean()
    .default(false)
    .description("实验性 tag 模式，默认关闭：steal 自动分类并生成多个 tags，提供 sticker_tags 工具并支持多 tag 发送"),
  fuzzyTagMatch: Schema.boolean().default(true).description("sticker_send 的 tag 使用模糊匹配，默认开启"),
  tagRandomRange: Schema.number()
    .min(0)
    .default(1)
    .description("tag 发送随机范围：0 只选最高匹配分，每增加 1 可随机放宽到下一档匹配分"),
  sendStaticAsGif: Schema.boolean()
    .default(true)
    .description("发送静态图片表情包时转为单帧 GIF，默认开启；GIF 原样发送"),
  stickerElement: Schema.boolean().default(true).description("允许 bot 直接输出 <sticker/> 发送表情，默认开启"),
});

export type { StickerConfig };
