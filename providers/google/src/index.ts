import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const name = "yesimbot-provider-google";
export const usage = "Google 提供商插件";
export const inject = ["yesimbot"];

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("google").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  chatModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("工具调用"),
      reasoning: Schema.boolean().default(false).description("推理"),
    }),
  )
    .role("table")
    .default([
      { id: "gemini-2.5-flash", toolCall: true, reasoning: true },
      { id: "gemini-2.5-pro", toolCall: true, reasoning: true },
      { id: "gemini-3.1-pro-preview", toolCall: true, reasoning: true },
      { id: "gemini-3.5-flash", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
  embeddingModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
    }),
  )
    .role("table")
    .default([])
    .description("可用嵌入模型列表"),
});

export function apply(ctx: Context, config: Config) {
  ctx.on("ready", () => {
    const client = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const dispose = ctx.yesimbot.model.register({
      id: config.id,
      capabilities: { chat: true, embedding: true },
      chatModels: () => config.chatModels,
      embeddingModels: () => config.embeddingModels ?? [],
      chat: (modelId: string) => client.chat(modelId),
      embedding: (modelId: string) => client.embedding(modelId),
    });
    ctx.on("dispose", dispose);
  });
}
