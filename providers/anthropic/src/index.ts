import { createAnthropic } from "@ai-sdk/anthropic";
import type { ToolSet } from "ai";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";
export const name = "yesimbot-provider-anthropic";

export const usage = "Anthropic 提供商插件";

export const inject = ["yesimbot"];

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  webSearch: Schema.boolean().default(false).description("启用原生 Web 搜索"),
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

export interface Config extends BaseProviderConfig {
  webSearch: boolean;
}

export function apply(ctx: Context, config: Config) {
  ctx.on("ready", () => {
    const client = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
    const dispose = ctx.yesimbot.model.register({
      id: config.id,
      capabilities: { chat: true, embedding: false },
      chatModels: () => config.chatModels,
      embeddingModels: () => [],
      chat: (modelId: string) => client.chat(modelId),
      embedding: () => {
        throw new Error(`Provider "${config.id}" does not support embedding`);
      },
      tools: (): ToolSet => (config.webSearch ? { web_search: client.tools.webSearch_20250305() } : {}),
    });
    ctx.on("dispose", dispose);
  });
}
