import type { Context } from "koishi";
import type { StorageDriver } from "@/services/assets/types";
import { LocalStorageDriver } from "./local";

/**
 * 存储驱动工厂
 */
export class StorageDriverFactory {
    /**
     * 创建存储驱动实例
     */
    static create(ctx: Context, type: string, config: any): StorageDriver {
        switch (type) {
            case "local":
                return new LocalStorageDriver(ctx, config);
            default:
                throw new Error(`Unsupported storage driver type: ${type}`);
        }
    }

    /**
     * 获取支持的驱动类型列表
     */
    static getSupportedTypes(): string[] {
        return ["local"];
    }
}

export { LocalStorageDriver };
