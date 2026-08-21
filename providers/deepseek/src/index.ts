import { createDeepSeek, type DeepSeekLanguageModelOptions } from "@ai-sdk/deepseek";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { Context, Schema } from "koishi";
import { type BaseProviderConfig } from "koishi-plugin-yesimbot";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const name = "yesimbot-provider-deepseek";

export const usage = "DeepSeek 提供商插件";

export const inject = ["yesimbot"];

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().role("link").description("API Base URL"),
  thinking: Schema.union([
    Schema.const("auto").description("自适应"),
    Schema.const("none").description("关闭"),
    Schema.const("low").description("低"),
    Schema.const("medium").description("中"),
    Schema.const("high").description("高"),
    Schema.const("xhigh").description("极高"),
    Schema.const("max").description("最大"),
  ])
    .default("high")
    .description("默认思考等级（模型 ID 可用 :level 覆盖）"),
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
      { id: "deepseek-v4-flash-vision-exp", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
}).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

type ThinkingLevel = "auto" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

interface Config extends BaseProviderConfig {
  thinking: ThinkingLevel;
}

export function apply(ctx: Context, config: Config) {
  const client = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.yesimbot.model.register({
    id: config.id,
    capabilities: { chat: true, embedding: false },
    chatModels: () => config.chatModels,
    embeddingModels: () => [],
    chat: (modelId: string) => {
      // modelId 可能带 :level 后缀，如 "deepseek-v4-pro:high"
      const colonIdx = modelId.lastIndexOf(":");
      let actualId = modelId;
      let level: ThinkingLevel = config.thinking;
      if (colonIdx > 0) {
        const suffix = modelId.slice(colonIdx + 1) as ThinkingLevel;
        if (["auto", "none", "low", "medium", "high", "xhigh", "max"].includes(suffix)) {
          actualId = modelId.slice(0, colonIdx);
          level = suffix;
        }
      }
      const opts: DeepSeekLanguageModelOptions =
        level === "none"
          ? { thinking: { type: "disabled" } }
          : level === "auto"
            ? { thinking: { type: "adaptive" } }
            : { thinking: { type: "enabled" }, reasoningEffort: level };
      return wrapLanguageModel({
        model: client.chat(actualId),
        middleware: [defaultSettingsMiddleware({ settings: { providerOptions: { deepseek: opts } } })],
      });
    },
    embedding: () => {
      throw new Error(`Provider "${config.id}" does not support embedding`);
    },
  });
  ctx.on("dispose", dispose);
}
