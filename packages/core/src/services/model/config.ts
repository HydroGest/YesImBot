import { Schema } from "koishi";
import { SwitchStrategy } from "./types";

export interface SharedSwitchConfig {
    /** 切换策略 */
    strategy: SwitchStrategy;
    /** 首字到达超时(ms) */
    firstToken: number;
    /** 请求超时时间(ms) */
    requestTimeout: number;
    /** 最大失败重试次数 */
    maxRetries: number;
    /** 熔断器设置 */
    breaker: {
        /** 是否启用熔断器 */
        enabled: boolean;
        /** 熔断阈值 */
        threshold?: number;
        /** 失败冷却时间(ms) */
        cooldown?: number;
        /** 熔断恢复时间(ms) */
        recoveryTime?: number;
    };
}

interface FailoverStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.Failover;
}

interface RoundRobinStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.RoundRobin;
}

interface RandomStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.Random;
}

interface WeightedRandomStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.WeightedRandom;
    modelWeights: Record<string, number>;
}

/* prettier-ignore */
export type SwitchConfig
    = | SharedSwitchConfig
        | FailoverStrategyConfig
        | RoundRobinStrategyConfig
        | RandomStrategyConfig
        | WeightedRandomStrategyConfig;

export const SwitchConfig: Schema<SwitchConfig> = Schema.intersect([
    Schema.object({
        strategy: Schema.union([
            Schema.const(SwitchStrategy.Failover).description("故障转移：按成功率/健康度排序，优先使用最好的。"),
            Schema.const(SwitchStrategy.RoundRobin).description("轮询：按顺序循环使用每个模型。"),
            Schema.const(SwitchStrategy.Random).description("随机：每次请求随机选择一个模型。"),
            Schema.const(SwitchStrategy.WeightedRandom).description("加权随机：根据设定的权重随机选择模型。"),
        ])
            .default(SwitchStrategy.Failover)
            .description("模型组的负载均衡与故障切换策略。"),
        firstToken: Schema.number().min(1000).default(30000).description("首字到达时的超时时间 (毫秒)。"),
        requestTimeout: Schema.number().min(1000).default(60000).description("单次请求的超时时间 (毫秒)。"),
        maxRetries: Schema.number().min(1).default(3).description("最大重试次数。"),
        breaker: Schema.object({
            enabled: Schema.boolean().default(false).description("启用熔断器以防止频繁调用失败的模型。"),
            threshold: Schema.number().min(1).default(5).description("触发熔断的连续失败次数阈值。"),
            cooldown: Schema.number().min(1000).default(60000).description("模型失败后，暂时禁用的冷却时间 (毫秒)。"),
            recoveryTime: Schema.number()
                .min(0)
                .default(300000)
                .description("熔断后，模型自动恢复服务的等待时间 (毫秒)。"),
        })
            .collapse()
            .description("熔断器配置"),
    }).description("切换策略"),
    Schema.union([
        Schema.object({ strategy: Schema.const(SwitchStrategy.Failover) }),
        Schema.object({ strategy: Schema.const(SwitchStrategy.RoundRobin) }),
        Schema.object({ strategy: Schema.const(SwitchStrategy.Random) }),
        Schema.object({
            strategy: Schema.const(SwitchStrategy.WeightedRandom),
            modelWeights: Schema.dict(Schema.number().min(0).default(1).description("权重"))
                .role("table")
                .description("为每个模型设置权重，权重越高被选中的概率越大。"),
        }),
    ]),
]);

export interface ModelGroup {
    name: string;
    models: string[];
}

export interface ModelServiceConfig {
    groups: ModelGroup[];
    chatModelGroup?: string;
    embeddingModel?: string;
    switchConfig: SwitchConfig;
    stream: boolean;
}

export const ModelServiceConfig: Schema<ModelServiceConfig> = Schema.object({
    groups: Schema.array(
        Schema.object({
            name: Schema.string().required().description("模型组的唯一名称。"),
            models: Schema.array(Schema.dynamic("registry.chatModels"))
                .required()
                .description("选择要加入此模型组的聊天模型。"),
        }).collapse(),
    )
        .description("将聊天模型组合成逻辑分组，用于故障转移或按需调用。"),
    chatModelGroup: Schema.dynamic("registry.availableGroups").description("选择一个模型组作为默认的聊天服务。"),
    embeddingModel: Schema.dynamic("registry.embedModels").description("指定用于生成文本嵌入的特定模型 (例如 openai>text-embedding-3-small)。"),
    switchConfig: SwitchConfig,
    stream: Schema.boolean().default(true).description("是否启用流式传输，以获得更快的响应体验。"),
}).description("模型与切换策略配置");
