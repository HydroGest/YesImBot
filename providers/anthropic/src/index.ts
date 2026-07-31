import { createAnthropic } from "@ai-sdk/anthropic";
import { Schema } from "koishi";
import { type BaseProviderConfig, createProviderPlugin } from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic").description("提供商标识"),
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
      { id: "claude-opus-4-6", toolCall: true, reasoning: true },
      { id: "claude-sonnet-4-6", toolCall: true, reasoning: true },
      { id: "claude-haiku-4-5-20251001", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
});

export default createProviderPlugin<Config, ReturnType<typeof createAnthropic>>({
  name: "yesimbot-provider-anthropic",
  capabilities: { chat: true, embedding: false },
  Config,
  createClient: ({ apiKey, baseURL }) => createAnthropic({ apiKey, baseURL }),
  chat: (client, modelId) => client.chat(modelId),
});
