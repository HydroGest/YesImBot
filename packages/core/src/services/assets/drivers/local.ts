import type { Context, Logger } from "koishi";
import type { Buffer } from "node:buffer";
import type { Stats } from "node:fs";
import type { FileStats, StorageDriver } from "../types";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

/**
 * 本地文件系统存储驱动
 */
export class LocalStorageDriver implements StorageDriver {
    private readonly logger: Logger;

    constructor(
        private readonly ctx: Context,
        public readonly baseDir: string,
    ) {
        this.logger = ctx.logger("[本地存储驱动]");
        this.ensureDirectory();
    }

    private async ensureDirectory() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
            this.logger.debug(`存储目录已确认: ${this.baseDir}`);
        } catch (error: any) {
            this.logger.error(`创建存储目录失败: ${error.message}`);
            throw error;
        }
    }

    public getPath(id: string): string {
        return resolve(this.baseDir, id);
    }

    async write(id: string, buffer: Buffer): Promise<void> {
        const filePath = this.getPath(id);
        try {
            await fs.writeFile(filePath, buffer);
            this.logger.debug(`资源已写入: ${id} (${buffer.length} bytes)`);
        } catch (error: any) {
            this.logger.error(`写入资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async read(id: string): Promise<Buffer> {
        const filePath = this.getPath(id);
        try {
            const buffer = await fs.readFile(filePath);
            this.logger.debug(`资源已读取: ${id} (${buffer.length} bytes)`);
            return buffer;
        } catch (error: any) {
            if (error.code === "ENOENT") {
                this.logger.warn(`资源文件不存在: ${id}`);
                // 抛出特定错误，由上层服务处理恢复逻辑
                error.message = `Resource file not found: ${id}`;
                throw error;
            }
            this.logger.error(`读取资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async delete(id: string): Promise<void> {
        const filePath = this.getPath(id);
        try {
            await fs.unlink(filePath);
            this.logger.debug(`资源已删除: ${id}`);
        } catch (error: any) {
            if (error.code === "ENOENT") {
                this.logger.debug(`尝试删除不存在的资源，已忽略: ${id}`);
                return;
            }
            this.logger.error(`删除资源失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async exists(id: string): Promise<boolean> {
        try {
            await fs.access(this.getPath(id));
            return true;
        } catch {
            return false;
        }
    }

    async getStats(id: string): Promise<FileStats | null> {
        try {
            const filePath = this.getPath(id);
            const stats: Stats = await fs.stat(filePath);
            return {
                size: stats.size,
                modifiedAt: stats.mtime,
                createdAt: stats.birthtime || stats.mtime,
            };
        } catch (error: any) {
            if (error.code === "ENOENT") {
                return null;
            }
            this.logger.error(`获取文件统计信息失败: ${id} - ${error.message}`);
            throw error;
        }
    }

    async listFiles(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.baseDir);
            return files.filter((file) => !file.startsWith("."));
        } catch (error: any) {
            if (error.code === "ENOENT") {
                return [];
            }
            this.logger.error(`列出文件失败: ${error.message}`);
            throw error;
        }
    }
}
