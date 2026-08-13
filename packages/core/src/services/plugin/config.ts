import { Schema } from "koishi";

export interface ToolServiceConfig {
    extra?: Record<string, { enabled?: boolean; [key: string]: any }>;
    /** 高级选项 */
    advanced?: {
        maxRetry?: number;
        retryDelay?: number;
        timeout?: number;
    };
}

// eslint-disable-next-line ts/no-redeclare
export const ToolServiceConfig = Schema.object({
    extra: Schema.dynamic("availablePlugins").default({}),

    advanced: Schema.object({
        maxRetry: Schema.number().default(3).description("最大重试次数"),
        retryDelay: Schema.number().default(1000).description("重试延迟时间（毫秒）"),
        timeout: Schema.number().default(10000).description("超时时间（毫秒）"),
    })
        .collapse()
        .description("高级选项"),
});
