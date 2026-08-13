import { Schema } from "koishi";

/** 记忆服务配置 */
export interface MemoryConfig {
    coreMemoryPath: string;
}

export const MemoryConfig: Schema<MemoryConfig> = Schema.object({
    coreMemoryPath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/yesimbot/memory/core")
        .description("核心记忆文件的存放路径"),
});
