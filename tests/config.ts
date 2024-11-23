export default {
  Group: {
    AllowedGroups: ["123"],
    AtReactPossibility: 1,
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
    NickorName: "用户昵称"
  },
  Debug: {
    DebugAsInfo: false,
    DisableGroupFilter: true,
    AllowErrorFormat: true,
    UpdatePromptOnLoad: false,
  },
  Embedding: {
    APIType: "Custom",
    BaseURL: "http://localhost:11434/api/embeddings",
    APIKey: "sk-xxxxxxx",
    EmbeddingModel: "nomic-embed-text",
    RequestBody: "{\"prompt\": \"<text>\", \"model\": \"<model>\"}",
    GetVecRegex: "(?<=\"embedding\":).*?(?=})"
  }
};
