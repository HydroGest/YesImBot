import { createOpenAI } from "@ai-sdk/openai";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {
  format: "chat" | "responses";
}

export const name = "yesimbot-provider-openai";
export const usage = "OpenAI 提供商插件";
export const inject = ["yesimbot"];
export const reusable = true;

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  format: Schema.union([Schema.const("chat"), Schema.const("responses")])
    .default("chat")
    .description("API 格式"),
  chatModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("工具调用"),
      reasoning: Schema.boolean().default(false).description("推理"),
    }),
  )
    .role("table")
    .default([
      { id: "gpt-4o", toolCall: true, reasoning: true },
      { id: "gpt-5.4", toolCall: true, reasoning: true },
      { id: "gpt-5.5", toolCall: true, reasoning: true },
      { id: "gpt-5.6-luna", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
  embeddingModels: Schema.array(Schema.object({ id: Schema.string().required().description("模型 ID") }))
    .role("table")
    .default([{ id: "text-embedding-3-small" }, { id: "text-embedding-3-large" }])
    .description("可用嵌入模型列表"),
});

export function apply(ctx: Context, config: Config) {
  ctx.on("ready", () => {
    const client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    const dispose = ctx.yesimbot.model.register({
      id: config.id,
      capabilities: { chat: true, embedding: true },
      chatModels: () => config.chatModels,
      embeddingModels: () => config.embeddingModels ?? [],
      chat: (modelId: string) => (config.format === "responses" ? client.responses(modelId) : client.chat(modelId)),
      embedding: (modelId: string) => client.embedding(modelId),
    });
    ctx.on("dispose", dispose);
  });
}
