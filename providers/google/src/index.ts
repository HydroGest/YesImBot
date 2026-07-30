import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Schema } from "koishi";
import {
  BaseProviderConfig,
  createChatModelsSchema,
  createEmbeddingModelsSchema,
  createProviderPlugin,
} from "koishi-plugin-yesimbot";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("google").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  chatModels: createChatModelsSchema([
    { id: "gemini-1.5-flash", toolCall: true, reasoning: false },
    { id: "gemini-1.5-pro", toolCall: true, reasoning: true },
  ]),
  embeddingModels: createEmbeddingModelsSchema([{ id: "text-embedding-004" }]),
});

export default createProviderPlugin<Config, ReturnType<typeof createGoogleGenerativeAI>>({
  name: "yesimbot-provider-google",
  capabilities: { chat: true, embedding: true },
  Config,
  createClient: ({ apiKey, baseURL }) => createGoogleGenerativeAI({ apiKey, baseURL }),
  chat: (client, modelId) => client.chat(modelId),
  embedding: (client, modelId) => client.embedding(modelId),
});
