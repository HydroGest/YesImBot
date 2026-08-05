import { generateText } from "ai";
import type { Context } from "koishi";

import { normalizeCategory, type StickerConfig } from "./types.js";

export interface ClassifyInput {
  bytes: Uint8Array;
  mediaType: string;
  categories: string[];
  signal?: AbortSignal;
}

export interface StickerClassifier {
  classify(input: ClassifyInput): Promise<string | undefined>;
}

export class ModelStickerClassifier implements StickerClassifier {
  public constructor(
    private readonly ctx: Context,
    private readonly config: StickerConfig,
  ) {}

  public async classify(input: ClassifyInput): Promise<string | undefined> {
    const modelId = this.config.classificationModel || this.ctx.yesimbot.model.getDefaultChatModelId();
    if (!modelId) return undefined;

    let ref;
    try {
      ref = this.ctx.yesimbot.model.resolveChatModel(modelId);
    } catch (cause) {
      this.ctx.logger("yesimbot.sticker-manager").warn("classification_model_unavailable", {
        modelId,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      return undefined;
    }

    if (!ref.entry.modalities?.input?.includes("image")) return undefined;

    const prompt = this.config.classificationPrompt.replaceAll(
      "{{categories}}",
      input.categories.join(", ") || "暂无分类",
    );

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
              { type: "file", data: input.bytes, mediaType: input.mediaType },
            ],
          },
        ],
      });
      return normalizeCategory(text) || undefined;
    } catch (cause) {
      this.ctx.logger("yesimbot.sticker-manager").warn("classification_call_failed", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      return undefined;
    }
  }
}
