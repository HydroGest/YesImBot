import { Config } from "../src";

export default {
  MemorySlot: {
    SlotContains: [
      "all",
      "private:all"
    ],
    AtReactPossibility: 1,
    MinTriggerCount: 1
  },
  API: {
    APIList: [
      {
        APIType: "OpenAI",
        BaseURL: "/openai",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Cloudflare",
        BaseURL: "/cloudflare",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Ollama",
        BaseURL: "/ollama",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
      {
        APIType: "Custom URL",
        BaseURL: "/custom",
        APIKey: "sk-xxxxxxx",
        AIModel: "gpt-3.5-turbo",
      },
    ],
  },
  Bot: {
    NickorName: "用户昵称",
    WordsPerSecond: 0,
    BotReplySpiltRegex: "(?<=[。?!？！])\s*",
  },
  Settings: {
    AllowErrorFormat: true,
    UpdatePromptOnLoad: false,
  },
  Debug: {
    DebugAsInfo: true,
    TestMode: true,
  },
  Embedding: {
    APIType: "Custom",
    BaseURL: "http://localhost:11434/api/embeddings",
    APIKey: "sk-xxxxxxx",
    EmbeddingModel: "nomic-embed-text",
    RequestBody: "{\"prompt\": \"<text>\", \"model\": \"<model>\"}",
    GetVecRegex: "(?<=\"embedding\":).*?(?=})"
  },
} as Config;
