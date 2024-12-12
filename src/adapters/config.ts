import { Schema } from "koishi";

export interface API {
  APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL";
  BaseURL: string;
  UID: string;
  APIKey: string;
  AIModel: string;
}

export interface Config {
  APIList: API[];
}

export const API: Schema<API> = Schema.object({
  APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL"])
    .default("OpenAI")
    .description("API 类型"),
  BaseURL: Schema.string()
    .default("https://api.openai.com/")
    .description("API 基础 URL, 设置为“Custom URL”需要填写完整的 URL"),
  UID: Schema.string()
    .default("若非 Cloudflare 可不填")
    .description("Cloudflare UID"),
  APIKey: Schema.string().required().description("你的 API 令牌"),
  AIModel: Schema.string()
    .default("@cf/meta/llama-3-8b-instruct")
    .description("模型 ID"),
});


export const Config: Schema<Config> = Schema.object({
  APIList: Schema.array(API).description(
    "单个 LLM API 配置，可配置多个 API 进行负载均衡。"
  ),
}).description("LLM API 相关配置");
