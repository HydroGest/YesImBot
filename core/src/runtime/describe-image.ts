import { jsonSchema, type AgentTool } from "@yesimbot/agent-runtime";
import { generateText, type LanguageModel } from "ai";

import type { AssetStore } from "../asset.js";
import { detectMediaType } from "./read.js";

const ASSET_URI = /^asset:\/\/[a-f0-9]{32}$/;

export interface DescribeImageInput {
  uri: string;
  question: string;
}

export type DescribeImageOutput = { text: string } | { error: string };

export function createDescribeImageTool(options: {
  readonly assets: AssetStore;
  readonly model: LanguageModel;
}): AgentTool<DescribeImageInput, DescribeImageOutput> {
  const { assets, model } = options;

  return {
    name: "describe_image",
    description: [
      "当你需要了解图片内容、但当前无法直接查看图片时，使用本工具调用外部视觉模型生成图片描述。",
      "uri：图片资源 URI，来自消息中的 [图片：asset://xxx] 或 read 工具返回的 uri，必须是 asset://<32位十六进制id>，不要拼接或猜测。",
      "question：你想从图片中获取的信息，例如“图片里有什么？”、“这是什么菜？”。",
      "返回 {text} 或 {error}：invalid_uri 表示 URI 形状不合法，检查后重写；asset_not_found 表示资源不存在；not_an_image 表示该资源不是已知格式的图片；vision_call_failed 表示外部模型调用失败，可重试一次。",
      "注意：一次只描述一张图片；动图可能不被外部模型接受。",
    ].join("\n"),
    inputSchema: jsonSchema<DescribeImageInput>({
      type: "object",
      properties: {
        uri: { type: "string", description: "要描述的图片资源 URI，形如 asset://<32位十六进制id>" },
        question: { type: "string", description: "要从图片中获取的信息" },
      },
      required: ["uri", "question"],
      additionalProperties: false,
    }),
    execute: async ({ uri, question }, execution) => {
      if (!ASSET_URI.test(uri)) return { error: "invalid_uri" };
      const id = uri.slice("asset://".length);
      let bytes: Uint8Array;
      try {
        bytes = await assets.get(id);
      } catch {
        return { error: "asset_not_found" };
      }
      const mediaType = detectMediaType(bytes);
      if (!mediaType) return { error: "not_an_image" };
      try {
        const { text } = await generateText({
          model,
          temperature: 0.2,
          abortSignal: execution.abortSignal,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `请详细描述这张图片，并回答问题：${question}\n\n图片内容：` },
                { type: "file", data: bytes, mediaType },
              ],
            },
          ],
        });
        return { text };
      } catch (cause) {
        return { error: `vision_call_failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    },
  };
}
