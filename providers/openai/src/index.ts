import { createOpenAI } from "@ai-sdk/openai";
import type { ToolSet } from "ai";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const name = "yesimbot-provider-openai";

export const usage = "OpenAI 提供商插件";

export const inject = ["yesimbot"];

export const reusable = true;

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    id: Schema.string().default("openai").description("提供商标识"),
    apiKey: Schema.string().role("secret").required().description("API Key"),
    baseURL: Schema.string().description("API Base URL"),
    format: Schema.union([Schema.const("chat"), Schema.const("responses")])
      .default("responses")
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
  }),
  Schema.union([
    Schema.object({ format: Schema.const("chat") }),
    Schema.object({ format: Schema.const("responses"), webSearch: Schema.boolean().default(false).description("启用原生 Web 搜索") }),
  ]),
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

interface Config extends BaseProviderConfig {
  format: "chat" | "responses";
  webSearch?: boolean;
}

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
      tools: (): ToolSet => (config.format === "responses" && config.webSearch ? { web_search: client.tools.webSearch() } : {}),
    });
    ctx.on("dispose", dispose);
  });
}
