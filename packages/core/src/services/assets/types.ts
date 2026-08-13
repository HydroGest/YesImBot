import type { Buffer } from "node:buffer";

/**
 * 数据库中存储的资源元数据模型
 */
export interface AssetData {
    id: string; // 主键, UUID
    mime: string; // 原始资源的 MIME 类型
    hash: string; // 原始文件内容的 SHA256 哈希
    size: number; // 原始文件大小（字节）
    createdAt: Date;
    lastUsedAt: Date;
    metadata: AssetMetadata;
}

/**
 * 资源元数据
 */
export interface AssetMetadata {
    filename?: string;
    src?: string; // 原始 URL, 用于恢复
    summary?: string;
    width?: number; // 原始图片宽度
    height?: number; // 原始图片高度
}

/**
 * 对外暴露的资源信息
 */
export interface AssetInfo extends Omit<AssetData, "hash"> {}

/**
 * 文件统计信息
 */
export interface FileStats {
    size: number;
    modifiedAt: Date;
    createdAt: Date;
}

/**
 * 存储驱动接口
 */
export interface StorageDriver {
    write: (id: string, buffer: Buffer) => Promise<void>;
    read: (id: string) => Promise<Buffer>;
    delete: (id: string) => Promise<void>;
    exists: (id: string) => Promise<boolean>;
    getStats?: (id: string) => Promise<FileStats | null>;
    listFiles?: () => Promise<string[]>;
}

/**
 * 图片处理选项
 */
export interface ImageProcessingOptions {
    /** 是否对图片进行处理 */
    process?: boolean;
    /** 目标格式，如 'webp' 或 'jpeg' */
    format?: "webp" | "jpeg";
}

/**
 * 读取资源时的选项
 */
export interface ReadAssetOptions {
    /** 输出格式 */
    format?: "buffer" | "base64" | "data-url";
    /** 针对图片资源的特定处理选项 */
    image?: ImageProcessingOptions;
}

export interface FileResponse {
    type: string;
    data: Buffer;
    filename?: string;
}
