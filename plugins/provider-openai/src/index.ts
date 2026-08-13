/* eslint-disable ts/no-require-imports */
import type { ChatModelAbility, ChatModelConfig, SharedConfig } from "@yesimbot/shared-model";
import type { Context } from "koishi";
import { classifyModels, createOpenAI, ModelType, normalizeBaseURL, SharedProvider } from "@yesimbot/shared-model";
import { Schema } from "koishi";

export interface ModelConfig extends ChatModelConfig {
    headers?: Record<string, string>;
    reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    max_completion_tokens?: number;
}

export interface Config extends SharedConfig<ModelConfig> {
    name: string;
    proxy?: string;
}

export default class OpenAIProvider extends SharedProvider<any, ModelConfig> {
    static Config: Schema<Config> = Schema.object({
        name: Schema.string().default("openai"),
        baseURL: Schema.string().default("https://api.openai.com/v1/"),
        apiKey: Schema.string().role("secret").required(),
        proxy: Schema.string().default(""),
        retryDefault: Schema.number().min(0).default(3),
        retryDelayDefault: Schema.number().min(0).default(1000),
        modelConfig: Schema.object({
            temperature: Schema.number().min(0).max(2).step(0.01).role("slider").default(1),
            topP: Schema.number().min(0).max(1).step(0.01).role("slider").default(1),
            frequencyPenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
            presencePenalty: Schema.number().min(-2).max(2).step(0.01).role("slider").default(0),
            headers: Schema.dict(String).role("table").default({}),
            reasoning_effort: Schema.union(["none", "minimal", "low", "medium", "high", "xhigh"]).default("medium"),
            max_completion_tokens: Schema.number(),
        }),
    }).i18n({
        "zh-CN": require("./locales/zh-CN.yml")._config,
        "en-US": require("./locales/en-US.yml")._config,
    });

    static name = "provider-openai";
    static usage = "";
    static inject = ["yesimbot.model"];
    static reusable = true;

    constructor(ctx: Context, config: Config) {
        const { baseURL } = config;
        const baseURLNormalized = normalizeBaseURL(baseURL);
        if (baseURLNormalized) {
            config.baseURL = baseURLNormalized;
        }
        super(config.name, config, createOpenAI(config.apiKey, config.baseURL));
        ctx.on("ready", async () => {
            const registry = ctx.get("yesimbot.model");
            if (!registry) {
                ctx.logger.warn("ProviderRegistry 未就绪，跳过注册");
                return;
            }

            try {
                registry.setProvider(this.name, this);
            } catch (err: any) {
                ctx.logger.warn(`注册 provider 失败: ${err?.message ?? String(err)}`);
            }

            try {
                const models = await this.getOnlineModels();
                ctx.logger.info(`获取到 ${models.length} 个模型信息`);

                const classified = classifyModels(models);

                const chatModels: Array<{
                    modelId: string;
                    modelType: ModelType.Chat;
                    abilities?: ChatModelAbility[];
                }> = [];
                const embedModels: Array<{ modelId: string; modelType: ModelType.Embed; dimension: number }> = [];
                const unknownModels: string[] = [];

                classified.forEach((info, modelId) => {
                    switch (info.modelType) {
                        case ModelType.Chat:
                            chatModels.push({
                                modelId,
                                modelType: ModelType.Chat,
                                abilities: info.abilities,
                            });
                            break;
                        case ModelType.Embed:
                            embedModels.push({
                                modelId,
                                modelType: ModelType.Embed,
                                dimension: info.dimension || 1536,
                            });
                            break;
                        case ModelType.Unknown:
                            unknownModels.push(modelId);
                            break;
                    }
                });

                if (chatModels.length > 0) {
                    registry.addChatModels(this.name, chatModels);
                    ctx.logger.info(`注册了 ${chatModels.length} 个 Chat 模型`);
                }

                if (embedModels.length > 0) {
                    registry.addEmbedModels(this.name, embedModels);
                    ctx.logger.info(`注册了 ${embedModels.length} 个 Embedding 模型`);
                }

                if (unknownModels.length > 0) {
                    registry.addUnknownModels(this.name, unknownModels);
                    /* prettier-ignore */
                    ctx.logger.warn(`发现 ${unknownModels.length} 个未分类模型: ${unknownModels.slice(0, 5).join(", ")}${unknownModels.length > 5 ? "..." : ""}`);
                }
            } catch (err: any) {
                ctx.logger.warn(`注册模型目录失败: ${err?.message ?? String(err)}`);
            }
        });

        ctx.on("dispose", () => {
            const registry = ctx.get("yesimbot.model");
            if (!registry) {
                return;
            }
            try {
                registry.removeProvider(this.name);
            } catch (err: any) {
                ctx.logger.warn(`注销 provider 失败: ${err?.message ?? String(err)}`);
            }
        });
    }
}
