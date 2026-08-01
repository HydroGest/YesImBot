import { createDeepSeek, type DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const name = "yesimbot-provider-deepseek";
export const usage = "DeepSeek 提供商插件";
export const inject = ["yesimbot"];

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek").description("提供商标识"),
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
      { id: "deepseek-v4-flash", toolCall: true, reasoning: true },
      { id: "deepseek-v4-pro", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
});

export function apply(ctx: Context, config: Config) {
  ctx.on("ready", () => {
    const client = createDeepSeek({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const dispose = ctx.yesimbot.model.register({
      id: config.id,
      capabilities: { chat: true, embedding: false },
      chatModels: () => config.chatModels,
      embeddingModels: () => [],
      chat: (modelId: string) =>
        wrapLanguageModel({
          model: client.chat(modelId),
          middleware: [
            defaultSettingsMiddleware({
              settings: {
                providerOptions: {
                  deepseek: {
                    reasoningEffort: "high",
                    thinking: {
                      type: "enabled",
                    },
                  } satisfies DeepSeekLanguageModelOptions,
                },
              },
            }),
          ],
        }),
      embedding: () => {
        throw new Error(`Provider "${config.id}" does not support embedding`);
      },
    });
    ctx.on("dispose", dispose);
  });
}
