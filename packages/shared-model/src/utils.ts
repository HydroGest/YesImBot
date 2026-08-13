import type { RequestInit as uRequestInit } from "undici";
import { ProxyAgent, fetch as ufetch } from "undici";

export type AnyFetch = typeof globalThis.fetch;

export interface RetryPolicy {
    retry: number;
    retryDelay?: number;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRetry(fetchFn: AnyFetch, policy: RetryPolicy): AnyFetch {
    const retry = Math.max(0, policy.retry ?? 0);
    const retryDelay = Math.max(0, policy.retryDelay ?? 0);

    if (retry <= 0)
        return fetchFn;

    return (async (input: any, init?: any) => {
        let lastError: unknown;

        for (let attempt = 0; attempt <= retry; attempt++) {
            try {
                const resp: Response = await (fetchFn as any)(input, init);

                if (resp && !resp.ok && (resp.status === 429 || (resp.status >= 500 && resp.status <= 599))) {
                    if (attempt < retry) {
                        await sleep(retryDelay);
                        continue;
                    }
                }

                return resp;
            } catch (err) {
                lastError = err;
                if (attempt < retry) {
                    await sleep(retryDelay);
                    continue;
                }
                throw err;
            }
        }

        // Should be unreachable.
        throw lastError;
    }) as unknown as AnyFetch;
}

function wrapFetch(fetchFn: AnyFetch): AnyFetch {
    return function (url: any, options?: any): Promise<Response> {
        return (fetchFn as any)(url, options) as Promise<Response>;
    } as unknown as AnyFetch;
}

export function useProxy(proxy: string): AnyFetch {
    const agent = new ProxyAgent(proxy);
    const customFetch: AnyFetch = (url: any, options?: RequestInit): Promise<Response> => {
        const init: uRequestInit = (options as uRequestInit) || {};
        init.dispatcher = agent;
        return ufetch(url, init) as unknown as Promise<Response>;
    };
    return wrapFetch(customFetch);
}

export interface SharedFetchOptions {
    fetch?: AnyFetch;
    proxy?: string;
    retry?: number;
    retryDelay?: number;
}

export function createSharedFetch(options: SharedFetchOptions = {}): AnyFetch {
    const baseFetch: AnyFetch = options.fetch
        ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) as AnyFetch : (ufetch as unknown as AnyFetch));

    const proxied = (options.proxy && options.proxy.length > 0)
        ? useProxy(options.proxy)
        : baseFetch;

    const retry = options.retry ?? 0;
    if (retry && retry > 0) {
        return withRetry(proxied, { retry, retryDelay: options.retryDelay ?? 1000 });
    }

    return proxied;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object")
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function deepMerge<T>(base: T, ...overrides: Array<Partial<T> | undefined>): T {
    let result: any = base;

    for (const override of overrides) {
        if (!override)
            continue;

        if (!isPlainObject(result) || !isPlainObject(override)) {
            result = override as any;
            continue;
        }

        const next: Record<string, unknown> = { ...result };
        for (const [key, value] of Object.entries(override)) {
            const current = (next as any)[key];

            if (isPlainObject(current) && isPlainObject(value)) {
                (next as any)[key] = deepMerge(current, value as any);
            } else {
                (next as any)[key] = value as any;
            }
        }

        result = next;
    }

    return result as T;
}

/**
 * 归一化 baseURL
 * 1. 去除首尾空格
 * 2. 移除末尾多余斜杠
 * 3. 智能补全/截断版本号：
 *    - 如果包含版本号(如 /v1, /v4)，则保留到版本号为止
 *    - 如果不包含版本号且无路径，会自动补全 /v1
 *    - 如果不包含版本号但有路径，则截断到域名根部
 */
export function normalizeBaseURL(url: string | undefined | null): string {
    let baseURL = (url || "").trim();
    if (!baseURL || baseURL.replace(/\/+$/, "") === "") {
        return "";
    }

    // 移除末尾斜杠
    baseURL = baseURL.replace(/\/+$/, "");

    // 检查版本号数量
    const versionMatches = baseURL.match(/\/v\d+(?=\/|$)/g);
    if (versionMatches && versionMatches.length > 1) {
        return baseURL;
    }

    // 如果包含版本号(如 /v1, /v4)，则截断到版本号为止
    if (versionMatches) {
        baseURL = baseURL.replace(/(\/v\d+)(?:\/.*)?$/, "$1");
    } else {
        // 如果没有版本号，则根据是否有路径决定补全还是截断
        const hasProtocol = baseURL.includes("://");
        try {
            const urlObj = new URL(hasProtocol ? baseURL : `http://${baseURL}`);
            if (urlObj.pathname !== "/" && urlObj.pathname !== "") {
                // 如果有路径（如 /chat/completions），截断到域名根部
                baseURL = hasProtocol ? urlObj.origin : urlObj.host;
            } else {
                // 如果无路径，补上 /v1
                baseURL = hasProtocol ? urlObj.origin : urlObj.host;
                baseURL += "/v1";
            }
        } catch (err) {
            return baseURL;
        }
    }

    return baseURL;
}
