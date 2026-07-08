import { Schema } from "koishi";

import type { ChatModelConfig, EmbeddingModelConfig } from "./types.js";

export function createChatModelsSchema(defaults: ChatModelConfig[]): Schema<ChatModelConfig[]> {
  const schema = Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("支持工具调用"),
      reasoning: Schema.boolean().default(false).description("支持推理"),
    }),
  )
    .role("table")
    .default(defaults as never)
    .description("可用聊天模型列表");
  return schema as Schema<ChatModelConfig[]>;
}

export function createEmbeddingModelsSchema(
  defaults: EmbeddingModelConfig[],
): Schema<EmbeddingModelConfig[]> {
  const schema = Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
    }),
  )
    .role("table")
    .default(defaults)
    .description("可用嵌入模型列表");
  return schema as Schema<EmbeddingModelConfig[]>;
}
