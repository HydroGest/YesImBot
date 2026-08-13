import type { Context } from "koishi";
import type { MemoryBlockData } from "./memory-block";
import type { Config } from "@/config";
import fs from "node:fs/promises";

import path from "node:path";
import { Service } from "koishi";
import { RESOURCES_DIR, Services } from "@/shared/constants";
import { MemoryBlock } from "./memory-block";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
}

export class MemoryService extends Service<Config> {
    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Memory, true);
        this.config = config;
    }

    protected start() {
        this.loadCoreMemoryBlocks();
    }

    public getMemoryBlocksForRendering(): MemoryBlockData[] {
        return Array.from(this.coreMemoryBlocks.values()).map((block) => block.toData());
    }

    /**
     * 扫描核心记忆目录，加载所有可用的记忆块
     */
    public async loadCoreMemoryBlocks() {
        const memoryPath = this.config.coreMemoryPath;
        try {
            await fs.mkdir(memoryPath, { recursive: true });
            const files = await fs.readdir(memoryPath);
            const memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));

            if (memoryFiles.length === 0) {
                this.logger.warn(`核心记忆目录 '${memoryPath}' 为空，将应用默认设定`);
                try {
                    const defaultMemoryFiles = await fs.readdir(path.join(RESOURCES_DIR, "memory_block"));

                    for (const file of defaultMemoryFiles) {
                        await fs.copyFile(path.join(RESOURCES_DIR, "memory_block", file), path.join(memoryPath, file));
                    }

                    this.loadCoreMemoryBlocks();
                } catch (error: any) {
                    this.logger.error(`复制默认记忆块失败: ${error.message}`);
                }
                return;
            }

            for (const file of memoryFiles) {
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, filePath);
                    if (this.coreMemoryBlocks.has(block.label)) {
                        this.logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'已忽略`);
                    } else {
                        this.coreMemoryBlocks.set(block.label, block);
                        this.logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'`);
                    }
                } catch (error: any) {
                    // this.logger.error(`加载记忆块文件 '${filePath}' 失败: ${error.message}`);
                }
            }
        } catch (error: any) {
            this.logger.error(`扫描核心记忆目录 '${memoryPath}' 失败: ${error.message}`);
        }
    }
}
