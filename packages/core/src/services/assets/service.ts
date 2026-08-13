import type { Context, Element } from "koishi";
import type { AssetData, AssetInfo, AssetMetadata, FileResponse, ReadAssetOptions, StorageDriver } from "./types";
import type { Config } from "@/config";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GifUtil } from "gifwrap";
import { Jimp } from "jimp";
import { h, Service } from "koishi";
import { v4 as uuidv4 } from "uuid";
import { Services, TableName } from "@/shared/constants";
import { formatSize, getMimeType, truncate } from "@/shared/utils";
import { LocalStorageDriver } from "./drivers/local";

const ELEMENT_TO_PROCESS = ["img", "image", "audio", "video", "file", "mface"];

/**
 * 根据 MIME 类型获取对应的 Koishi 元素标签名
 * @param mime - MIME 类型字符串
 * @returns 元素标签名 ('img', 'audio', 'video', 'file')
 */
function getTagNameFromMime(mime: string): string {
    if (!mime)
        return "file";
    const mainType = mime.split("/")[0];
    switch (mainType) {
        case "image":
            return "img";
        case "audio":
            return "audio";
        case "video":
            return "video";
        default:
            return "file";
    }
}

declare module "koishi" {
    interface Context {
        [Services.Asset]: AssetService;
    }
    interface Tables {
        [TableName.Assets]: AssetData;
    }
}

/**
 * 资源管理服务 (AssetService)
 * 负责资源的持久化存储、去重、读取、处理和生命周期管理
 */
export class AssetService extends Service<Config> {
    static readonly inject = ["database", "server", "http"];

    // 缓存和常量
    private static readonly PROCESSED_IMAGE_CACHE_SUFFIX = ".p.jpeg";
    private static readonly MAX_COMPRESSION_ATTEMPTS = 5; // 压缩图片时的最大尝试次数

    private storage: StorageDriver;
    private cacheStorage: StorageDriver;

    private assetEndpoint: string;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Asset, true);
        this.config = config;
        this.config.maxFileSize *= 1024 * 1024; // 转换为字节
        this.assetEndpoint = this.config.assetEndpoint;
    }

    protected async start() {
        // 初始化存储驱动
        this.storage = new LocalStorageDriver(this.ctx, this.config.storagePath);
        this.cacheStorage = new LocalStorageDriver(this.ctx, this.config.image.processedCachePath);

        // 扩展数据库表
        this.ctx.model.extend(
            TableName.Assets,
            {
                id: "string(36)",
                mime: "string(128)",
                hash: "string(64)",
                size: "unsigned",
                createdAt: "timestamp",
                lastUsedAt: "timestamp",
                metadata: "json",
            },
            { primary: "id", unique: ["hash"] },
        );

        // 设置自动清理任务
        if (this.config.autoClear.enabled) {
            const interval = this.config.autoClear.intervalHours * 3600 * 1000;
            this.ctx.setInterval(() => this.runAutoClear(), interval);
            try {
                // 首次运行立即执行清理
                await this.runAutoClear();
            } catch (error: any) {
                this.logger.error("资源自动清理任务失败:", error.message);
                this.logger.debug(error.stack);
            }
        }

        // 注册 HTTP 访问端点
        if (this.assetEndpoint) {
            this.registerHttpEndpoint();
        }
    }

    /**
     * 同步转换消息内容，将外部资源链接持久化并替换为内部ID
     * 此方法会等待所有资源持久化完成
     * @param source - 原始消息字符串或元素数组
     * @returns 转换后的消息字符串
     */
    async transform(source: string | Element[]): Promise<string> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        const transformedElements = await h.transformAsync(elements, (el) => this._processTransformElement(el, false));
        return transformedElements.join("");
    }

    /**
     * 异步转换消息内容，立即返回带占位符ID的消息，并在后台进行资源持久化
     * 适用于不要求立即使用资源的场景，可以提高响应速度
     * @param source - 原始消息字符串或元素数组
     * @returns 转换后的消息字符串
     */
    async transformAsync(source: string | Element[]): Promise<string> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        const transformedElements = await h.transformAsync(elements, (el) => this._processTransformElement(el, true));
        return transformedElements.join("");
    }

    /**
     * 创建一个新资源。
     * @param source - 资源的来源 (Buffer, data:, file:, http(s): URL)
     * @param metadata - 资源的元数据
     * @param options - 内部选项，如预设的ID
     * @returns 资源的唯一 ID
     */
    async create(source: string | Buffer, metadata: AssetMetadata = {}, options: { id?: string } = {}): Promise<string> {
        const { data, type } = await this._getSourceBuffer(source);
        if (!data || data.length === 0)
            throw new Error("资源内容为空");

        const hash = createHash("sha256").update(data).digest("hex");
        const [existing] = await this.ctx.database.get(TableName.Assets, { hash });

        if (existing) {
            await this._updateLastUsed(existing.id);
            return existing.id;
        }

        // 如果是图片，尝试获取尺寸信息
        if (type.startsWith("image/")) {
            try {
                const jimp = await Jimp.read(data);
                metadata.width = jimp.width;
                metadata.height = jimp.height;
            } catch (error: any) {
                this.logger.warn(`无法解析图片元数据: ${error.message}`);
            }
        }

        const id = options.id || uuidv4();
        await this.storage.write(id, data);

        const assetData: AssetData = {
            id,
            mime: type,
            hash,
            size: data.length,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            metadata,
        };

        await this.ctx.database.upsert(TableName.Assets, [assetData]);
        this.logger.info(`新资源已存储 | ID: ${id} | 类型: ${type} | 大小: ${formatSize(data.length)}`);
        return id;
    }

    /**
     * 根据ID读取资源
     * 支持按需进行图片处理和缓存
     * @param id - 资源 ID
     * @param options - 读取选项，可控制是否处理图片和返回格式
     * @returns 资源内容，格式由 options.format 决定
     */
    async read(id: string, options: ReadAssetOptions = {}): Promise<Buffer | string> {
        const asset = await this._getAssetWithUpdate(id);
        if (!asset)
            throw new Error(`数据库中找不到资源: ${id}`);

        let finalBuffer: Buffer;
        const shouldProcess = options.image?.process && asset.mime.startsWith("image/");
        const cacheId = id + AssetService.PROCESSED_IMAGE_CACHE_SUFFIX;

        if (shouldProcess && (await this.cacheStorage.exists(cacheId))) {
            this.logger.debug(`命中处理后图片缓存: ${cacheId}`);
            finalBuffer = await this.cacheStorage.read(cacheId);
        } else {
            const originalBuffer = await this._readOriginalWithRecovery(id, asset);
            if (shouldProcess) {
                this.logger.debug(`无缓存，开始实时处理图片: ${id}`);
                finalBuffer = await this._processImage(originalBuffer, asset.mime);
                await this.cacheStorage.write(cacheId, finalBuffer);
                this.logger.debug(`处理结果已缓存: ${cacheId}`);
            } else {
                finalBuffer = originalBuffer;
            }
        }

        const { format = "buffer" } = options;
        switch (format) {
            case "base64":
                return finalBuffer.toString("base64");
            case "data-url": // 处理后的图片统一为 webp 或 jpeg，需要确定MIME
            {
                const outputMime = shouldProcess ? "image/jpeg" : asset.mime;
                return `data:${outputMime};base64,${finalBuffer.toString("base64")}`;
            }
            default:
                return finalBuffer;
        }
    }

    /**
     * 根据 ID 获取资源的元信息
     * @param id - 资源 ID
     * @returns 资源的元信息，若不存在则返回 null
     */
    async getInfo(id: string): Promise<AssetInfo | null> {
        const asset = await this._getAssetWithUpdate(id);
        if (!asset)
            return null;
        const { hash, ...info } = asset; // 移除不应公开的 hash 字段
        return info;
    }

    /**
     * 获取资源的公开访问链接
     * @param id - 资源 ID
     * @returns 资源的公开链接，若未配置 endpoint 则回退到 data URL
     */
    async getPublicUrl(id: string): Promise<string> {
        if (!this.assetEndpoint) {
            this.logger.warn(`未配置公开访问端点，为资源 ${id} 回退到 Base64 Data URL`);
            return (await this.read(id, { format: "data-url" })) as string;
        }

        await this._updateLastUsed(id); // 确保访问时更新使用时间
        const endpoint = this.assetEndpoint.endsWith("/") ? this.assetEndpoint : `${this.assetEndpoint}/`;
        return `${endpoint}${id}`;
    }

    /**
     * 将包含内部资源ID的消息元素编码为平台可发送的URL或元素
     * @param source - 消息字符串或元素数组
     * @returns 编码后的元素数组
     */
    async encode(source: string | Element[]): Promise<Element[]> {
        const elements = typeof source === "string" ? h.parse(source) : source;
        return h.transformAsync(elements, async (element) => {
            if (!element.attrs.id)
                return element;
            if (!ELEMENT_TO_PROCESS.includes(element.type))
                return element;

            const info = await this.getInfo(element.attrs.id);
            if (!info) {
                this.logger.warn(`编码时找不到资源: ${element.attrs.id}，将返回原始元素`);
                return element;
            }

            try {
                // 使用 getPublicUrl 确保逻辑统一
                const src = await this.getPublicUrl(element.attrs.id);
                const tagName = getTagNameFromMime(info.mime);
                const { id, ...restAttrs } = element.attrs;
                return h(tagName, { ...restAttrs, src });
            } catch (error: any) {
                this.logger.error(`获取资源 "${element.attrs.id}" 的公开链接失败: ${error.message}`);
                return element;
            }
        });
    }

    // --- 私有方法 ---

    /**
     * 处理 transform/transformAsync 中的单个元素
     */
    private async _processTransformElement(element: Element, isAsync: boolean): Promise<Element> {
        if (!ELEMENT_TO_PROCESS.includes(element.type))
            return element;
        const originalUrl = element.attrs.src || element.attrs.url || element.attrs.file;
        const filename = element.attrs.filename || element.attrs.name || element.attrs.fileName;
        if (!originalUrl || element.attrs.id)
            return element;

        // 根据元素类型和URL协议决定是否处理
        let tagName = element.type;

        if (tagName === "mface") {
            tagName = "img";
        }

        if (tagName === "file" && !String(originalUrl).startsWith("http")) {
            return element; // 只处理网络文件资源
        }

        const metadata: AssetMetadata = {
            filename,
            src: originalUrl,
            summary: element.attrs.summary,
        };

        const { src, ...displayAttrs } = metadata;

        if (tagName === "img") {
            delete displayAttrs.filename;
        }

        if (isAsync) {
            const placeholderId = uuidv4();
            // 立即返回带占位符ID的元素，后台执行持久化
            (async () => {
                try {
                    await this.create(originalUrl, metadata, { id: placeholderId });
                } catch (error: any) {
                    this.logger.error(`后台资源持久化失败 (ID: ${placeholderId}, 源: ${truncate(originalUrl, 100)}): ${error.message}`);
                    // 可在此处添加失败处理逻辑，如更新数据库标记此ID无效
                }
            })();
            return h(tagName, { ...displayAttrs, id: placeholderId });
        } else {
            try {
                const id = await this.create(originalUrl, metadata);
                return h(tagName, { ...displayAttrs, id });
            } catch (error: any) {
                this.logger.error(`资源持久化失败 (源: ${truncate(originalUrl, 100)}): ${error.message}`);
                return element; // 失败时返回原始元素
            }
        }
    }

    private async _getSourceBuffer(source: string | Buffer): Promise<FileResponse> {
        if (Buffer.isBuffer(source)) {
            const mime = getMimeType(source);
            return {
                type: mime,
                data: source,
            };
        }
        if (source.startsWith("data:")) {
            const match = source.match(/^data:.+;base64,(.*)$/);
            if (!match)
                throw new Error("无效的 data: URL 格式");
            return {
                type: match[0].split("/")[1].split(";")[0],
                data: Buffer.from(match[1], "base64"),
            };
        }
        if (source.startsWith("file://")) {
            const filepath = fileURLToPath(source);
            const data = readFileSync(filepath);
            return {
                type: getMimeType(data),
                data,
            };
        }
        if (source.startsWith("http")) {
            return this._downloadResource(source);
        }
        throw new Error(`不支持的资源来源: "${truncate(source, 50)}"`);
    }

    private async _downloadResource(url: string): Promise<FileResponse> {
        try {
            const head = await this.ctx.http.head(url, { timeout: this.config.downloadTimeout / 2 });
            const contentLength = head.get("content-length");
            if (contentLength && Number(contentLength) > this.config.maxFileSize) {
                throw new Error(`文件大小 (${formatSize(Number(contentLength))}) 超出限制 (${formatSize(this.config.maxFileSize)})`);
            }
        } catch (error: any) {
            if (error.message.includes("超出限制"))
                throw error;
        }

        const response = await this.ctx.http.file(url, { timeout: this.config.downloadTimeout });

        return {
            type: response.type,
            data: Buffer.from(response.data),
            filename: response.filename,
        };
    }

    private async _readOriginalWithRecovery(id: string, asset: AssetData): Promise<Buffer> {
        try {
            return await this.storage.read(id);
        } catch (error: any) {
            // 如果文件在本地丢失，且开启了恢复功能，且有原始链接，则尝试恢复
            if (error.code === "ENOENT" && this.config.recoveryEnabled && asset.metadata.src) {
                this.logger.warn(`本地文件 ${id} 丢失，尝试从 ${asset.metadata.src} 恢复...`);
                try {
                    const { data } = await this._getSourceBuffer(asset.metadata.src);
                    await this.storage.write(id, data); // 恢复文件
                    this.logger.success(`资源 ${id} 已成功恢复`);
                    return data;
                } catch (error: any) {
                    this.logger.error(`资源 ${id} 恢复失败: ${error.message}`);
                    throw error; // 抛出恢复失败的错误
                }
            }
            throw error; // 抛出原始的读取错误
        }
    }

    private async _processImage(buffer: Buffer, mime: string): Promise<Buffer> {
        try {
            if (mime === "image/gif") {
                try {
                    // 验证是否为有效的GIF
                    const gif = await GifUtil.read(buffer);

                    if (this.config.image.gifProcessingStrategy === "stitch") {
                        return await this._processGifStitch(buffer);
                    }
                    if (this.config.image.gifProcessingStrategy === "firstFrame") {
                        return await this._processGifFirstFrame(gif);
                    }
                } catch (error: any) {
                    this.logger.warn(`GIF处理失败，将按静态图片处理: ${error.message}`);
                    // 如果GIF处理失败，按普通图片处理
                    return await this._compressAndResizeImage(buffer);
                }
                // `gifProcessingStrategy` 为 'none' 或其他值，不处理
                return buffer;
            }

            return await this._compressAndResizeImage(buffer);
        } catch (error: any) {
            this.logger.error(`图片处理失败: ${error.message}`);
            // 如果处理失败，返回原始buffer
            return buffer;
        }
    }

    private async _compressAndResizeImage(buffer: Buffer): Promise<Buffer> {
        const jimpInstance = await Jimp.read(buffer);
        const { targetSize } = this.config.image;

        // 调整尺寸
        if (jimpInstance.width > targetSize || jimpInstance.height > targetSize) {
            // 保持宽高比缩放
            const ratio = Math.min(targetSize / jimpInstance.width, targetSize / jimpInstance.height);
            const newWidth = Math.round(jimpInstance.width * ratio);
            const newHeight = Math.round(jimpInstance.height * ratio);
            jimpInstance.resize({ w: newWidth, h: newHeight });
        }

        // 动态调整质量进行压缩
        const maxSizeBytes = this.config.image.maxSizeMB * 1024 * 1024;
        let quality = 90;
        let compressedBuffer: Buffer;

        for (let i = 0; i < AssetService.MAX_COMPRESSION_ATTEMPTS; i++) {
            compressedBuffer = await jimpInstance.getBuffer("image/jpeg", { quality });
            if (compressedBuffer.length <= maxSizeBytes) {
                this.logger.debug(`图片压缩成功，质量: ${quality}, 大小: ${formatSize(compressedBuffer.length)}`);
                return compressedBuffer;
            }
            quality -= 10;
            this.logger.debug(`压缩后大小为 ${formatSize(compressedBuffer.length)}，超出限制，降低质量至 ${quality} 重试...`);
        }

        this.logger.warn(`无法将图片压缩到 ${this.config.image.maxSizeMB}MB 以下，将使用最后一次压缩结果`);
        return compressedBuffer;
    }

    /**
     * 处理GIF第一帧提取
     * @param gif - gifwrap读取的GIF对象
     * @returns 处理后的图片buffer
     */
    private async _processGifFirstFrame(gif: any): Promise<Buffer> {
        const firstFrame = gif.frames[0];
        const { targetSize } = this.config.image;

        // 创建新的Jimp实例从第一帧数据
        const jimpFrame = new Jimp({
            width: firstFrame.bitmap.width,
            height: firstFrame.bitmap.height,
            color: 0x00000000,
        });

        // 复制像素数据
        jimpFrame.bitmap.data = Buffer.from(firstFrame.bitmap.data);

        // 调整尺寸
        if (jimpFrame.width > targetSize || jimpFrame.height > targetSize) {
            const ratio = Math.min(targetSize / jimpFrame.width, targetSize / jimpFrame.height);
            const newWidth = Math.round(jimpFrame.width * ratio);
            const newHeight = Math.round(jimpFrame.height * ratio);
            jimpFrame.resize({ w: newWidth, h: newHeight });
        }

        // 压缩并返回JPEG格式
        return jimpFrame.getBuffer("image/jpeg", { quality: 85 });
    }

    /**
     * 处理GIF动图，提取关键帧并拼接成静态图
     * @param buffer
     * @returns
     */
    private async _processGifStitch(buffer: Buffer): Promise<Buffer> {
        const { gifFramesToExtract, targetSize } = this.config.image;

        // 使用gifwrap读取GIF
        const gif = await GifUtil.read(buffer);
        const totalFrames = gif.frames.length;

        if (totalFrames <= 1) {
            // 如果是静态GIF，按普通图片处理
            return this._compressAndResizeImage(buffer);
        }

        // 限制最大帧数，防止内存溢出
        const maxFrames = Math.min(gifFramesToExtract, totalFrames, 9); // 最多9帧
        const frameIndices = Array.from({ length: maxFrames }, (_, i) => Math.floor(i * (totalFrames / maxFrames)));

        // 预设缩略图尺寸
        const thumbSize = Math.min(320, targetSize);

        // 创建帧缩略图
        const frames = [];
        for (const index of frameIndices) {
            const frame = gif.frames[index];

            // 计算缩放比例
            const ratio = Math.min(
                thumbSize / frame.bitmap.width,
                thumbSize / frame.bitmap.height,
                1.0, // 不放大
            );

            const newWidth = Math.round(frame.bitmap.width * ratio);
            const newHeight = Math.round(frame.bitmap.height * ratio);

            // 创建缩略图
            const thumb = new Jimp({
                width: newWidth,
                height: newHeight,
                color: 0x00000000,
            });

            // 如果尺寸变化，先缩放原始帧
            if (ratio < 1) {
                const tempJimp = new Jimp({
                    width: frame.bitmap.width,
                    height: frame.bitmap.height,
                    color: 0x00000000,
                });
                tempJimp.bitmap.data = Buffer.from(frame.bitmap.data);
                tempJimp.resize({ w: newWidth, h: newHeight });
                thumb.bitmap.data = Buffer.from(tempJimp.bitmap.data);
            } else {
                thumb.bitmap.data = Buffer.from(frame.bitmap.data);
            }

            frames.push(thumb);
        }

        // 计算拼接布局
        const cols = Math.ceil(Math.sqrt(frames.length));
        const rows = Math.ceil(frames.length / cols);

        // 计算画布尺寸
        const frameWidth = frames[0].width;
        const frameHeight = frames[0].height;
        const finalWidth = cols * frameWidth;
        const finalHeight = rows * frameHeight;

        // 创建拼接画布
        const canvas = new Jimp({
            width: finalWidth,
            height: finalHeight,
            color: 0xFFFFFFFF, // 白色背景
        });

        // 将帧拼接到画布上
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = col * frameWidth;
            const y = row * frameHeight;

            canvas.composite(frame, x, y);
        }

        // 如果整体尺寸过大，进行最终缩放
        const maxTotalSize = targetSize;
        if (canvas.width > maxTotalSize || canvas.height > maxTotalSize) {
            const ratio = Math.min(maxTotalSize / canvas.width, maxTotalSize / canvas.height);
            const newWidth = Math.round(canvas.width * ratio);
            const newHeight = Math.round(canvas.height * ratio);
            canvas.resize({ w: newWidth, h: newHeight });
        }

        // 压缩并返回JPEG格式
        return canvas.getBuffer("image/jpeg", { quality: 80 });
    }

    private async _getAssetWithUpdate(id: string): Promise<AssetData | null> {
        const [asset] = await this.ctx.database.get(TableName.Assets, { id });
        if (!asset)
            return null;
        await this._updateLastUsed(id);
        return asset;
    }

    private async _updateLastUsed(id: string): Promise<void> {
        await this.ctx.database.set(TableName.Assets, { id }, { lastUsedAt: new Date() });
    }

    private registerHttpEndpoint() {
        const routePath = this.assetEndpoint.startsWith("/") ? this.assetEndpoint : new URL(this.assetEndpoint).pathname;
        const finalRoute = `${routePath.replace(/\/$/, "")}/:id`; // 确保路径格式正确

        this.ctx.server.get(finalRoute, async (ctx) => {
            const { id } = ctx.params;
            try {
                const info = await this.getInfo(id);
                if (!info)
                    throw new Error("Asset not found in database");

                const buffer = await this.storage.read(id);
                ctx.status = 200;
                ctx.set("Content-Type", info.mime);
                ctx.set("Content-Length", info.size.toString());
                ctx.set("Cache-Control", "public, max-age=31536000, immutable"); // 长期缓存
                ctx.body = buffer;
            } catch (error: any) {
                // 如果是文件找不到，返回404，否则可能为其他服务器错误，但为简单起见统一返回404
                this.logger.warn(`通过 HTTP 端点提供资源 ${id} 失败: ${error.message}`);
                ctx.status = 404;
                ctx.body = "Asset not found";
            }
        });
        this.logger.info(`HTTP 服务端点已注册: GET ${finalRoute}`);
    }

    private async runAutoClear() {
        await this._clearExpiredByDatabase();
        await this._clearOrphanedFiles();
    }

    private async _clearExpiredByDatabase() {
        const cutoffDate = new Date(Date.now() - this.config.autoClear.maxAgeDays * 24 * 3600 * 1000);
        const expiredAssets = await this.ctx.database.get(TableName.Assets, { lastUsedAt: { $lt: cutoffDate } });

        if (!expiredAssets.length) {
            return;
        }

        let deletedFileCount = 0;
        for (const asset of expiredAssets) {
            try {
                await this.storage.delete(asset.id);
                // 同时删除可能存在的处理后缓存
                await this.cacheStorage.delete(asset.id + AssetService.PROCESSED_IMAGE_CACHE_SUFFIX).catch(() => {});
                deletedFileCount++;
            } catch (error: any) {
                if (error.code !== "ENOENT") {
                    // 如果文件本就不存在，则忽略错误
                    this.logger.error(`删除物理文件 ${asset.id} 失败: ${error.message}`);
                }
            }
        }

        const { removed } = await this.ctx.database.remove(TableName.Assets, { lastUsedAt: { $lt: cutoffDate } });
    }

    private async _clearOrphanedFiles() {
        if (!this.storage.listFiles || !this.storage.getStats) {
            return;
        }

        const allFiles = await this.storage.listFiles();
        const orphanedFiles: string[] = [];

        // 获取所有数据库中的资源ID
        const allAssets = await this.ctx.database.get(TableName.Assets, {});
        const existingIds = new Set(allAssets.map((asset) => asset.id));

        let deletedOrphanedCount = 0;

        for (const fileName of allFiles.filter(
            (file) =>
                path.join(this.ctx.baseDir, this.config.storagePath, file)
                !== path.join(this.ctx.baseDir, this.config.image.processedCachePath),
        )) {
            // 跳过处理后的缓存文件
            if (fileName.endsWith(AssetService.PROCESSED_IMAGE_CACHE_SUFFIX)) {
                continue;
            }

            const fileId = fileName;

            // 如果文件在数据库中没有对应记录，则为孤立文件
            if (!existingIds.has(fileId)) {
                orphanedFiles.push(fileId);

                try {
                    await this.storage.delete(fileId);

                    // 删除可能存在的处理后缓存
                    await this.cacheStorage.delete(fileId + AssetService.PROCESSED_IMAGE_CACHE_SUFFIX).catch(() => {});

                    deletedOrphanedCount++;
                } catch (error: any) {
                    if (error.code !== "ENOENT") {
                        this.logger.error(`删除孤立文件 ${fileId} 失败: ${error.message}`);
                    }
                }
            }
        }
    }
}
