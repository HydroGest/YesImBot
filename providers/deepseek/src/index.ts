import { createDeepSeek, type DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { Schema } from "koishi";
import {
  BaseProviderConfig,
  createChatModelsSchema,
  createProviderPlugin,
} from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  chatModels: createChatModelsSchema([
    { id: "deepseek-chat", toolCall: true, reasoning: false },
    { id: "deepseek-reasoner", toolCall: true, reasoning: true },
    { id: "deepseek-v4-flash", toolCall: true, reasoning: true },
    { id: "deepseek-v4-pro", toolCall: true, reasoning: true },
  ]),
});

export default createProviderPlugin<Config, ReturnType<typeof createDeepSeek>>({
  name: "yesimbot-provider-deepseek",
  capabilities: { chat: true, embedding: false },
  Config,
  createClient: ({ apiKey, baseURL }) => createDeepSeek({ apiKey, baseURL }),
  chat: (client, modelId) =>
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
});
