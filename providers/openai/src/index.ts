import { createOpenAI } from "@ai-sdk/openai";
import { Schema } from "koishi";
import {
  BaseProviderConfig,
  createChatModelsSchema,
  createEmbeddingModelsSchema,
  createProviderPlugin,
} from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {
  format: "chat" | "responses";
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  format: Schema.union([Schema.const("chat"), Schema.const("responses")])
    .default("chat")
    .description("API 格式"),
  chatModels: createChatModelsSchema([
    { id: "gpt-4o", toolCall: true, reasoning: false },
    { id: "o3-mini", toolCall: true, reasoning: true },
  ]),
  embeddingModels: createEmbeddingModelsSchema([{ id: "text-embedding-3-large" }]),
});

export default createProviderPlugin<Config, ReturnType<typeof createOpenAI>>({
  name: "yesimbot-provider-openai",
  capabilities: { chat: true, embedding: true },
  Config,
  createClient: ({ apiKey, baseURL }) => createOpenAI({ apiKey, baseURL }),
  chat: (client, modelId, config) =>
    config.format === "responses" ? client.responses(modelId) : client.chat(modelId),
  embedding: (client, modelId) => client.embedding(modelId),
});
