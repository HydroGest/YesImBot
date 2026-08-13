import type { Buffer } from "node:buffer";
import fs from "node:fs/promises";

import { isEmpty } from "./string";

/**
 * 转义字符串中的正则表达式特殊字符。
 * @param str - 需要转义的字符串。
 * @returns 转义后的字符串。
 */
function escapeRegExp(str: string): string {
    // $& 表示整个被匹配的字符串
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 检查消息内容是否包含过滤词列表中的任意一个词（不区分大小写）。
 * @param content - 要检查的内容。
 * @param filterList - 过滤词字符串数组。
 * @returns 如果包含任意一个过滤词，则返回 true，否则返回 false。
 */
export function containsFilter(content: string, filterList: string[]): boolean {
    const validFilters = filterList.filter((f) => !isEmpty(f));
    if (validFilters.length === 0) {
        return false;
    }

    // 将所有过滤词转义并用 | 连接，编译成一个正则表达式。
    // 这比在循环中为每个词创建新 RegExp 对象要高效得多。
    const pattern = validFilters.map(escapeRegExp).join("|");
    const regex = new RegExp(pattern, "i"); // 使用 'i' 标志进行不区分大小写的匹配

    return regex.test(content);
}

/**
 * 格式化日期对象或时间戳为指定格式的字符串。
 * @param date - Date 对象或毫秒级时间戳。
 * @param format - 格式化模板，默认为 "YYYY-MM-DD HH:mm:ss"。
 *   支持的标记：YYYY, YY, MM, M, DD, D, HH, H, mm, m, ss, s
 * @returns 格式化后的日期字符串。
 */
export function formatDate(date: Date | number, format: string = "YYYY-MM-DD HH:mm:ss"): string {
    const d = typeof date === "number" ? new Date(date) : date;
    const pad = (num: number) => String(num).padStart(2, "0");

    const replacements: { [key: string]: string } = {
        YYYY: String(d.getFullYear()),
        YY: String(d.getFullYear()).slice(-2),
        MM: pad(d.getMonth() + 1),
        M: String(d.getMonth() + 1),
        DD: pad(d.getDate()),
        D: String(d.getDate()),
        HH: pad(d.getHours()),
        H: String(d.getHours()),
        mm: pad(d.getMinutes()),
        m: String(d.getMinutes()),
        ss: pad(d.getSeconds()),
        s: String(d.getSeconds()),
    };

    // 使用回调函数进行一次性替换，避免顺序问题
    const regex = /YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g;
    return format.replace(regex, (match) => replacements[match] || match);
}

/**
 * 根据频道 ID 的格式判断其类型。
 * @param channelId - 频道 ID。
 * @returns 频道类型: "private", "guild", 或 "sandbox"。
 */
export function getChannelType(channelId: string): "private" | "guild" | "sandbox" {
    if (channelId.startsWith("private:")) {
        return "private";
    }
    if (channelId === "#") {
        return "sandbox";
    }
    return "guild";
}

/**
 * 从 URL 下载文件并保存到本地，支持流式写入以优化大文件处理。
 * @param url - 文件 URL。
 * @param filePath - 本地保存路径（包含文件名）。
 * @param overwrite - 如果文件已存在，是否覆盖。默认为 false。
 * @throws 如果下载失败、文件已存在且 overwrite 为 false，则会抛出错误。
 */
export async function downloadFile(url: string, filePath: string, overwrite: boolean = false): Promise<void> {
    try {
        await fs.access(filePath);
        if (!overwrite) {
            throw new Error(`File already exists at ${filePath} and overwrite is false.`);
        }
    } catch (error: any) {
        // 如果错误不是 "文件不存在"，则重新抛出
        if (error.code !== "ENOENT") {
            throw error;
        }
        // 文件不存在，可以继续下载，忽略此错误
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
        throw new Error("The response body is empty.");
    }

    // 使用流式写入，对大文件内存友好
    // Node.js v16.15.0+ 的 fs.writeFile可以直接处理Web Stream
    // 对于旧版本，需要手动pipe
    await fs.writeFile(filePath, response.body);
}

/**
 * 将各种类型的值转换为布尔值。
 * 规则：
 * - 布尔值: 直接返回
 * - 字符串: 'true', '1' -> true; 'false', '0' -> false (不区分大小写，忽略空格)
 * - 数字: 1 -> true; 0 -> false
 * - 其他: 使用 JavaScript 的隐式转换规则 (!!value)
 * @param value - 任意类型的值。
 * @returns 转换后的布尔值。
 */
export function toBoolean(value: any): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const lowerValue = value.toLowerCase().trim();
        if (lowerValue === "true" || lowerValue === "1")
            return true;
        if (lowerValue === "false" || lowerValue === "0")
            return false;
    }
    if (typeof value === "number") {
        if (value === 1)
            return true;
        if (value === 0)
            return false;
    }
    return Boolean(value);
}

/**
 * 使用正则表达式估算文本的 token 数量（一种不依赖第三方库的近似方法）。
 * 对长文本更内存友好。
 * @param text - 需要估算的文本。
 * @returns {number} 估算的 token 数量。
 */
export function estimateTokensByRegex(text: string): number {
    if (!text) {
        return 0;
    }

    // 正则表达式解释:
    // [\u4e00-\u9fa5]      - 匹配单个中文字符
    // | [a-zA-Z]+          - 匹配一个或多个连续的英文字母（一个单词）
    // | \d+                - 匹配一个或多个连续的数字
    // | [^\s\da-zA-Z\u4e00-\u9fa5] - 匹配任何非空白、非数字、非英文、非中文的单个字符（主要是标点符号）
    const regex = /[\u4E00-\u9FA5]|[a-z]+|\d+|[^\s\da-z\u4E00-\u9FA5]/gi;

    let count = 0;
    // 使用 exec 循环代替 match，避免为长文本创建巨大的匹配数组，从而节省内存
    while (regex.exec(text) !== null) {
        count++;
    }

    return count;
}

/**
 * 异步等待指定的毫秒数。
 * @param ms - 等待的毫秒数。
 * @returns 一个在指定时间后 resolve 的 Promise。
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将一个数字限制在指定的最小和最大值之间。
 * @param num - 要限制的数字。
 * @param min - 允许的最小值。
 * @param max - 允许的最大值。
 * @returns 限制后的数字。
 */
export function clamp(num: number, min: number, max: number): number {
    return Math.min(Math.max(num, min), max);
}

/**
 * 创建一个防抖函数，该函数会从上一次被调用后，延迟 `wait` 毫秒后调用 `func` 方法。
 * @param func - 要防抖的函数。
 * @param wait - 需要延迟的毫秒数。
 * @returns 返回新的防抖函数。
 */
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null;
    return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
        // eslint-disable-next-line ts/no-this-alias
        const context = this;
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            timeout = null;
            func.apply(context, args);
        }, wait);
    };
}

interface MimeTypeSignature {
    mime: string;
    validate: (buffer: Uint8Array) => boolean;
}

function check(buffer: Uint8Array, signature: number[], offset: number = 0): boolean {
    if (offset + signature.length > buffer.length) {
        return false;
    }

    for (let i = 0; i < signature.length; i++) {
        if (buffer[offset + i] !== signature[i]) {
            return false;
        }
    }
    return true;
}

// 定义已知文件类型的签名列表
const knownMimeTypes: MimeTypeSignature[] = [
    // 图片类型
    {
        mime: "image/jpeg",
        validate: (buf) => check(buf, [0xFF, 0xD8, 0xFF]),
    },
    {
        mime: "image/png",
        validate: (buf) => check(buf, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    },
    {
        mime: "image/gif",
        // GIF87a 和 GIF89a
        validate: (buf) => check(buf, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || check(buf, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
    },
    {
        mime: "image/webp",
        // 检查 RIFF 头部和 WEBP 标识
        validate: (buf) => check(buf, [0x52, 0x49, 0x46, 0x46]) && check(buf, [0x57, 0x45, 0x42, 0x50], 8),
    },
    {
        mime: "image/bmp",
        validate: (buf) => check(buf, [0x42, 0x4D]),
    },
    {
        mime: "image/tiff",
        // 两种字节序
        validate: (buf) => check(buf, [0x49, 0x49, 0x2A, 0x00]) || check(buf, [0x4D, 0x4D, 0x00, 0x2A]),
    },
    {
        mime: "image/avif",
        validate: (buf) => check(buf, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4),
    },

    // 文档类型
    {
        mime: "application/pdf",
        validate: (buf) => check(buf, [0x25, 0x50, 0x44, 0x46]),
    },

    // 压缩包/复合文档类型
    {
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
        validate: (buf) => check(buf, [0x50, 0x4B, 0x03, 0x04]) && check(buf, [0x77, 0x6F, 0x72, 0x64, 0x2F]), // PK.. 和 'word/'
    },
    {
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
        validate: (buf) => check(buf, [0x50, 0x4B, 0x03, 0x04]) && check(buf, [0x78, 0x6C, 0x2F]), // PK.. 和 'xl/'
    },
    {
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
        validate: (buf) => check(buf, [0x50, 0x4B, 0x03, 0x04]) && check(buf, [0x70, 0x70, 0x74, 0x2F]), // PK.. 和 'ppt/'
    },
    {
        mime: "application/zip",
        validate: (buf) =>
            check(buf, [0x50, 0x4B, 0x03, 0x04]) || check(buf, [0x50, 0x4B, 0x05, 0x06]) || check(buf, [0x50, 0x4B, 0x07, 0x08]),
    },
    {
        mime: "application/x-rar-compressed",
        validate: (buf) => check(buf, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]),
    },
    {
        mime: "application/x-7z-compressed",
        validate: (buf) => check(buf, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]),
    },

    // 音视频类型
    {
        mime: "video/mp4",
        validate: (buf) => check(buf, [0x66, 0x74, 0x79, 0x70], 4), // 'ftyp' at offset 4
    },
    {
        mime: "video/x-msvideo", // avi
        validate: (buf) => check(buf, [0x52, 0x49, 0x46, 0x46]) && check(buf, [0x41, 0x56, 0x49, 0x20], 8), // RIFF and AVI
    },
    {
        mime: "video/quicktime", // .mov
        validate: (buf) => check(buf, [0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20], 4), // 'ftypqt'
    },
    {
        mime: "audio/mpeg", // mp3
        validate: (buf) => check(buf, [0x49, 0x44, 0x33]) || check(buf, [0xFF, 0xFB]), // ID3 tag or frame sync
    },
    {
        mime: "audio/wav",
        validate: (buf) => check(buf, [0x52, 0x49, 0x46, 0x46]) && check(buf, [0x57, 0x41, 0x56, 0x45], 8), // RIFF and WAVE
    },
];

/**
 * 根据文件 Buffer 数据判断文件的 MIME 类型
 * @param data 文件的 Buffer 数据。在 Node.js 中是 Buffer，在浏览器中可以是 Uint8Array。
 * @returns 文件的 MIME 类型字符串。如果无法识别，则返回 'application/octet-stream'。
 */
export function getMimeType(data: Buffer | Uint8Array): string {
    // 处理空或无效的输入
    if (!data || data.length === 0) {
        return "application/octet-stream";
    }

    // Node.js 的 Buffer 是 Uint8Array 的一个子类，所以可以直接使用
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

    // 遍历已知的签名进行匹配
    for (const type of knownMimeTypes) {
        if (type.validate(buffer)) {
            return type.mime;
        }
    }

    // 如果没有匹配到任何已知的类型，返回通用的二进制流类型
    return "application/octet-stream";
}
