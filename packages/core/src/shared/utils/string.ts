/**
 * @file 字符串处理工具函数
 */

/**
 * 检查字符串是否为 null、undefined、空字符串或仅包含空白字符。
 * @param str - 要检查的字符串。
 * @returns 如果字符串为空或仅包含空白，则返回 true，否则返回 false。
 * @example
 * isEmpty(null); // true
 * isEmpty(''); // true
 * isEmpty('  '); // true
 * isEmpty('hello'); // false
 */
export function isEmpty(str: string | null | undefined): boolean {
    // 使用 str == null 同时检查 null 和 undefined
    // trim() 用于移除首尾空白，然后检查长度
    return str == null || str.trim() === "";
}

/**
 * 检查字符串是否非空（包含至少一个非空白字符）。
 * 这是 `isEmpty` 的反函数。
 * @param str - 要检查的字符串。
 * @returns 如果字符串包含非空白字符，则返回 true，否则返回 false。
 */
export function isNotEmpty(str: string | null | undefined): boolean {
    return !isEmpty(str);
}

/**
 * 将文件大小（字节）格式化为更易读的字符串。
 * @param bytes - 文件大小，单位为字节。
 * @param decimals - 保留的小数位数，默认为 2。
 * @returns 格式化后的大小字符串，如 "1.23 MB"。
 */
export function formatSize(bytes: number, decimals: number = 2): string {
    if (bytes === 0)
        return "0 B";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

    // 使用对数计算来直接定位单位，比循环更高效
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${units[i]}`;
}

/**
 * 生成指定长度的随机字符串（仅包含大小写字母和数字）。
 * @warning 此函数生成的字符串**不具有密码学安全性**，请勿用于密码、令牌等敏感场景。
 * @param length - 期望的字符串长度。
 * @returns 生成的随机字符串。
 */
export function randomString(length: number): string {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    // 创建一个数组然后 join，通常比循环中的字符串拼接性能更好
    const result = Array.from({ length });
    for (let i = 0; i < length; i++) {
        result[i] = characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result.join("");
}

/**
 * 截断长字符串以便于显示，并在末尾添加省略号。
 * @param str - 要截断的原始字符串。
 * @param length - 目标最大长度（不含省略号），默认为 80。
 * @returns 截断后的字符串。
 */
export function truncate(str: string, length: number = 80): string {
    if (str.length <= length) {
        return str;
    }
    // 确保返回的字符串不会因为省略号而超过预期太多
    return `${str.slice(0, length)}...`;
}

/**
 * 将任何类型的对象安全地转换为字符串。
 * 如果输入是字符串，则直接返回；否则，使用 JSON.stringify 进行转换。
 * @param obj - 要转换的对象。
 * @param fallback - 当 JSON.stringify 失败时（例如循环引用）返回的备用值。
 * @returns 转换后的字符串。
 */
export function stringify(obj: any, space?: number, fallback: string = ""): string {
    if (typeof obj === "string")
        return obj;
    if (obj == null)
        return fallback; // 处理 null 和 undefined
    try {
        return JSON.stringify(obj, null, space);
    } catch (error: any) {
        console.error("Failed to stringify object:", error);
        // 对于无法序列化的对象（如含循环引用），返回备用值
        return fallback;
    }
}

/**
 * 移除字符串开头的空白字符。
 * @param text - 输入字符串。
 * @returns 移除开头空白后的字符串。
 */
export function trimStart(text: string): string {
    // 使用原生方法，性能更优
    return text.trimStart();
}

/**
 * 移除字符串末尾的空白字符。
 * @param text - 输入字符串。
 * @returns 移除末尾空白后的字符串。
 */
export function trimEnd(text: string): string {
    // 使用原生方法，性能更优
    return text.trimEnd();
}

/**
 * 移除字符串首尾的空白字符。
 * @param text - 输入字符串。
 * @returns 移除首尾空白后的字符串。
 */
export function trim(text: string): string {
    // 使用原生方法，性能更优
    return text.trim();
}

/**
 * 生成字符串的简单哈希值（32位整数的 base-36 表示）。
 * @warning 此哈希函数非常简单，**不具有密码学安全性**，仅适用于非安全场景，如数据分桶、生成唯一键等。
 * @param str - 输入字符串。
 * @returns 一个简短的哈希字符串。
 */
export function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // 转换为32位有符号整数
    }
    // 使用 toString(36) 得到更短的字母数字混合字符串
    return Math.abs(hash).toString(36);
}

// --- 新增功能 ---

/**
 * 将字符串的第一个字符转换为大写。
 * @param str - 输入字符串。
 * @returns 首字母大写的字符串。
 */
export function capitalize(str: string): string {
    if (!str)
        return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 将字符串转换为驼峰命名（camelCase）。
 * @param str - 输入字符串 (e.g., 'hello-world' or 'hello_world')。
 * @returns 驼峰命名格式的字符串。
 */
export function toCamelCase(str: string): string {
    if (!str)
        return "";
    return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
}

/**
 * 将字符串转换为蛇形命名（snake_case）。
 * @param str - 输入字符串 (e.g., 'helloWorld' or 'hello-world')。
 * @returns 蛇形命名格式的字符串。
 */
export function toSnakeCase(str: string): string {
    if (!str)
        return "";
    return str
        .replace(/([A-Z])/g, "_$1") // 在大写字母前加下划线
        .replace(/[-_\s]+/g, "_") // 将连字符、下划线、空格替换为单个下划线
        .toLowerCase();
}

/**
 * 将字符串转换为烤串命名（kebab-case）。
 * @param str - 输入字符串 (e.g., 'helloWorld' or 'hello_world')。
 * @returns 烤串命名格式的字符串。
 */
export function toKebabCase(str: string): string {
    if (!str)
        return "";
    return str
        .replace(/([A-Z])/g, "-$1") // 在大写字母前加连字符
        .replace(/[_\s]+/g, "-") // 将下划线、空格替换为单个连字符
        .toLowerCase();
}

/**
 * 解析键字符串，支持点分隔和方括号索引格式。
 * 例如 "a.b[0].c" => ["a", "b", 0, "c"]
 * @param keyString 原始键字符串
 * @returns (string | number)[] 包含字符串键和数字索引的数组
 */
export function parseKeyChain(keyString: string): (string | number)[] {
    const parts: (string | number)[] = [];
    // 使用正则表达式匹配 "key" 或 "key[index]" 模式
    // 分割字符串，允许点分隔或方括号分隔
    // 考虑 "root.items[0].name" 这样的情况
    // 简化处理：先按点分割，再处理方括号
    keyString.split(".").forEach((segment) => {
        const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
        if (arrayMatch) {
            // 匹配到如 'items[0]'
            parts.push(arrayMatch[1]); // 键名 'items'
            parts.push(Number.parseInt(arrayMatch[2], 10)); // 索引 0
        } else {
            // 匹配普通键如 'name'
            parts.push(segment);
        }
    });
    // 验证解析结果，防止空字符串或不符合规范的键
    if (parts.some((p) => typeof p === "string" && p.trim() === "")) {
        throw new Error("配置键包含无效的空片段");
    }
    if (parts.length === 0) {
        throw new Error("无法解析配置键");
    }
    return parts;
}

/**
 * 智能地尝试将字符串转换为最合适的原始类型或JSON对象/数组。
 */
export function tryParse(value: string): any {
    // 1. 尝试解析为布尔值
    const lowerValue = value.toLowerCase().trim();
    if (lowerValue === "true")
        return true;
    if (lowerValue === "false")
        return false;
    // 2. 尝试解析为数字 (但排除仅包含空格或空字符串)
    // 使用 parseFloat 确保能处理小数，同时 Number() 检查 NaN 来排除非数字字符串
    if (!Number.isNaN(Number(value)) && !Number.isNaN(Number.parseFloat(value))) {
        return Number(value);
    }
    // 3. 尝试解析为JSON (对象或数组)
    try {
        const parsedJSON = JSON.parse(value);
        // 确保解析出来的确实是对象或数组，而不是JSON字符串代表的原始值
        // 例如 '123' 会被 JSON.parse 解析为数字 123，但我们已经在前面处理了数字
        // 所以这里只关心真正的对象或数组
        if ((typeof parsedJSON === "object" && parsedJSON !== null) || Array.isArray(parsedJSON)) {
            return parsedJSON;
        }
    } catch (e) {

        // 解析失败，不是有效的JSON
    }
    // 4. Fallback: 如果都不是，则认为是普通字符串
    return value;
}
