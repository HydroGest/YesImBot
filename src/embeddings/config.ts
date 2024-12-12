import { Schema } from "koishi";

export interface Config {
  Enabled?: boolean;
  APIType?: string;
  BaseURL?: string;
  APIKey?: string;
  EmbeddingModel?: string;
  EmbeddingDims?: number;
  RequestBody?: string;
  GetVecRegex?: string;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    Enabled: Schema.boolean().default(false).description("是否启用 Embedding"),
  }).description("Embedding 配置"),
  Schema.union([
    Schema.object({
      Enabled: Schema.const(true).required(),
      APIType: Schema.union(["OpenAI", "Custom", "Ollama"])
        .default("OpenAI")
        .description("Embedding API 类型"),
      BaseURL: Schema.string()
        .default("https://api.openai.com")
        .description("Embedding API 基础 URL"),
      APIKey: Schema.string().description("API 令牌"),
      EmbeddingModel: Schema.string()
        .default("text-embedding-3-large")
        .description("Embedding 模型 ID"),
      EmbeddingDims: Schema.number()
        .default(1536)
        .description("Embedding 向量维度"),
      RequestBody: Schema.string().description("自定义请求体。其中：`<text>`（包含尖括号）会被替换成用于计算嵌入向量的文本；`<apikey>`（包含尖括号）会被替换成此页面设置的 API 密钥；<model>（包含尖括号）会被替换成此页面设置的模型名称"),
      GetVecRegex: Schema.string().description("从自定义Embedding服务提取嵌入向量的正则表达式。注意转义"),
    }),
    Schema.object({}),
  ]),
]);
