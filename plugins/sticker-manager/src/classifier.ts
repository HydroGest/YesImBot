import { generateText } from "ai";
import type { Context } from "koishi";

import { firstFrameToPng } from "./frames.js";
import { normalizeCategory, type StickerConfig } from "./types.js";

export interface ClassifyInput {
  bytes: Uint8Array;
  mediaType: string;
  categories: string[];
  signal?: AbortSignal;
}

export interface ClassifyResult {
  category?: string;
  tags?: string[];
}

export interface StickerClassifier {
  classify(input: ClassifyInput): Promise<ClassifyResult | undefined>;
}

export class ModelStickerClassifier implements StickerClassifier {
  public constructor(
    private readonly ctx: Context,
    private readonly config: StickerConfig,
  ) {}

  public async classify(input: ClassifyInput): Promise<ClassifyResult | undefined> {
    const modelId = this.config.classificationModel || this.ctx.yesimbot.model.getDefaultChatModelId();
    if (!modelId) return undefined;

    let ref;
    try {
      ref = this.ctx.yesimbot.model.resolveChatModel(modelId);
    } catch (cause) {
      this.ctx
        .logger("yesimbot.sticker-manager")
        .warn("classification_model_unavailable", { modelId, cause: cause instanceof Error ? cause.message : String(cause) });
      return undefined;
    }

    if (!ref.entry.modalities?.input?.includes("image")) return undefined;

    const basePrompt = this.config.classificationPrompt.replaceAll("{{categories}}", input.categories.join(", ") || "暂无分类");
    const prompt = this.config.tagMode
      ? [
          basePrompt,
          '同时返回一个 JSON 对象：{"category":"分类名","tags":["标签1","标签2"]}',
          "category 只返回一个分类；tags 返回 1-16 个简短标签，可以包含 category。不要输出其他内容。",
        ].join("\n")
      : basePrompt;
    const frame = input.mediaType === "image/gif" ? firstFrameToPng(input.bytes) : undefined;

    try {
      const { text } = await generateText({
        model: ref.model,
        temperature: 0.2,
        abortSignal: input.signal,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "file", data: frame?.bytes ?? input.bytes, mediaType: frame?.mediaType ?? input.mediaType },
            ],
          },
        ],
      });
      return parseClassification(text, this.config.tagMode);
    } catch (cause) {
      this.ctx.logger("yesimbot.sticker-manager").warn("classification_call_failed", { cause: cause instanceof Error ? cause.message : String(cause) });
      return undefined;
    }
  }
}

function parseClassification(text: string, tagMode: boolean): ClassifyResult {
  const fallbackCategory = normalizeCategory(text) || undefined;
  if (!tagMode) return { category: fallbackCategory, tags: [] };

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { category?: unknown; tags?: unknown };
    const category = typeof parsed.category === "string" ? normalizeCategory(parsed.category) : undefined;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map(normalizeCategory)
          .filter((tag) => tag.length > 0)
      : [];
    return { category, tags };
  } catch {
    return { category: fallbackCategory, tags: [] };
  }
}
