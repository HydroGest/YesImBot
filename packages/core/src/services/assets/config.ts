import { Schema } from "koishi";

export interface AssetServiceConfig {
    storagePath: string;
    driver: "local";
    assetEndpoint?: string;
    maxFileSize: number;
    downloadTimeout: number;
    autoClear: {
        enabled: boolean;
        intervalHours: number;
        maxAgeDays: number;
    };
    image: {
        processedCachePath: string;
        // resizeEnabled: boolean;
        targetSize: number;
        maxSizeMB: number;
        gifProcessingStrategy: "firstFrame" | "stitch";
        gifFramesToExtract: number;
    };
    recoveryEnabled: boolean;
}

export const AssetServiceConfig: Schema<AssetServiceConfig> = Schema.object({
    storagePath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/assets")
        .description("资源本地存储路径"),

    driver: Schema.union([Schema.const("local")])
        .default("local")
        .description("存储驱动类型"),

    assetEndpoint: Schema.string().role("link").description("公开访问端点 URL (可选)"),

    maxFileSize: Schema.number().min(1).default(100).description("允许存储的单个文件的最大大小（MB）"),
    downloadTimeout: Schema.number().min(1000).default(30000).description("下载外部资源的超时时间（毫秒）"),

    autoClear: Schema.object({
        enabled: Schema.boolean().default(true).description("是否启用自动清理过期资源"),
        intervalHours: Schema.number().min(1).default(24).description("自动清理周期（小时）"),
        maxAgeDays: Schema.number().min(1).default(7).description("资源最长保留天数"),
    }).description("自动清理配置"),

    image: Schema.object({
        processedCachePath: Schema.path({ allowCreate: true, filters: ["directory"] })
            .default("data/assets/processed")
            .description("处理后图片的缓存存储路径"),
        // resizeEnabled: Schema.boolean().default(true).description("读取图片时是否启用动态缩放和压缩"),
        targetSize: Schema.union([512, 768, 1024, 1536, 2048]).default(1024).description("图片处理后长边的目标最大像素") as Schema<number>,
        maxSizeMB: Schema.number().min(0.5).max(10).default(3).description("处理后图片文件的最大体积（MB）"),
        gifProcessingStrategy: Schema.union(["firstFrame", "stitch"])
            .default("stitch")
            .description("GIF 动图处理策略：'firstFrame' (提取第一帧) 或 'stitch' (拼接多帧)"),
        gifFramesToExtract: Schema.number().min(2).max(16).default(6).description("当策略为 'stitch' 时，提取并拼接的 GIF 关键帧数量"),
    }).description("图片处理配置"),

    recoveryEnabled: Schema.boolean().default(true).description("是否启用资源恢复机制"),
});
