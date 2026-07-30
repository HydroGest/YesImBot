import { createAnthropic } from "@ai-sdk/anthropic";
import { Schema } from "koishi";
import {
  BaseProviderConfig,
  createChatModelsSchema,
  createProviderPlugin,
} from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  chatModels: createChatModelsSchema([
    { id: "claude-opus-4-6", toolCall: true, reasoning: true },
    { id: "claude-sonnet-4-6", toolCall: true, reasoning: true },
    { id: "claude-haiku-4-5-20251001", toolCall: true, reasoning: true },
  ]),
});

export default createProviderPlugin<Config, ReturnType<typeof createAnthropic>>({
  name: "yesimbot-provider-anthropic",
  capabilities: { chat: true, embedding: false },
  Config,
  createClient: ({ apiKey, baseURL }) => createAnthropic({ apiKey, baseURL }),
  chat: (client, modelId) => client.chat(modelId),
});
