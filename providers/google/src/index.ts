import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Schema } from "koishi";
import { type BaseProviderConfig, createProviderPlugin } from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

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

export default createProviderPlugin<Config, ReturnType<typeof createGoogleGenerativeAI>>({
  name: "yesimbot-provider-google",
  capabilities: { chat: true, embedding: true },
  Config,
  createClient: ({ apiKey, baseURL }) => createGoogleGenerativeAI({ apiKey, baseURL }),
  chat: (client, modelId) => client.chat(modelId),
  embedding: (client, modelId) => client.embedding(modelId),
});
