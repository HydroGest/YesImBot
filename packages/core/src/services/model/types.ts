export enum SwitchStrategy {
    RoundRobin = "round_robin", // 轮询：依次使用每个模型
    Failover = "failover", // 故障转移：按成功率/健康度排序，优先使用最好的
    Random = "random", // 随机：随机选择模型
    WeightedRandom = "weighted_random", // 加权随机：根据权重和成功率选择
}

/**
 * 定义了模型可能发生的错误类型
 */
export enum ModelErrorType {
    NetworkError = "network_error", // 网络错误 (e.g., DNS, TCP, connection reset)
    RateLimitError = "rate_limit_error", // API限流错误 (e.g., HTTP 429)
    AuthenticationError = "auth_error", // 认证/授权错误 (e.g., HTTP 401, 403, invalid API key)
    ContentFilterError = "content_filter", // 内容安全策略触发
    InvalidRequestError = "invalid_request", // 请求参数或格式错误 (e.g., HTTP 400)
    ServerError = "server_error", // 服务端内部错误 (e.g., HTTP 500, 502, 503)
    TimeoutError = "timeout_error", // 请求超时
    QuotaExceededError = "quota_exceeded", // API配额用尽
    AbortError = "abort_error", // 请求被主动中止
    UnknownError = "unknown_error", // 未知或未分类的错误
}

/**
 * 封装模型调用过程中发生的错误，提供统一的分类和重试判断
 */
export class ModelError extends Error {
    constructor(
        public readonly type: ModelErrorType,
        message: string,
        public readonly originalError?: unknown,
        public readonly retryable: boolean = true,
    ) {
        super(message);
        this.name = "ModelError";
    }

    /**
     * 判断此错误是否可以安全地重试 (通常在另一个模型上)
     */
    canRetry(): boolean {
        return this.retryable;
    }

    /**
     * 将原始错误对象分类为 ModelError
     * @param error The original error object, which can be of any type.
     * @returns A classified ModelError instance.
     */
    static classify(error: unknown): ModelError {
        if (error instanceof ModelError) {
            return error;
        }

        const err = error as Error;
        const message = (err.message || "").toLowerCase();
        const name = (err.name || "").toLowerCase();
        const anyErr = err as any;
        const status: number | undefined = anyErr?.status ?? anyErr?.response?.status;
        const code = String(anyErr?.code || "").toUpperCase();

        // 优先按 HTTP 状态码分类
        if (typeof status === "number") {
            if (status === 401 || status === 403)
                return new ModelError(ModelErrorType.AuthenticationError, err.message, err, false);
            if (status === 408)
                return new ModelError(ModelErrorType.TimeoutError, err.message, err, true);
            if (status === 400)
                return new ModelError(ModelErrorType.InvalidRequestError, err.message, err, false);
            if (status === 429) {
                // 429 有两类：限流与配额耗尽
                const isQuota = message.includes("quota") || message.includes("insufficient_quota");
                return new ModelError(
                    isQuota ? ModelErrorType.QuotaExceededError : ModelErrorType.RateLimitError,
                    err.message,
                    err,
                    !isQuota,
                );
            }
            if (status >= 500 && status <= 599)
                return new ModelError(ModelErrorType.ServerError, err.message, err, true);
        }

        // 请求被中止 (通常由 AbortSignal 触发)
        if (name === "aborterror" || message.includes("aborted")) {
            return new ModelError(ModelErrorType.AbortError, err.message, err, true);
        }

        // 超时错误
        if (name === "timeouterror" || message.includes("timeout") || code.includes("ETIMEDOUT")) {
            return new ModelError(ModelErrorType.TimeoutError, err.message, err, true);
        }

        // 限流错误
        if (message.includes("rate limit") || message.includes("too many requests") || /\b429\b/.test(message)) {
            return new ModelError(ModelErrorType.RateLimitError, err.message, err, true);
        }

        // 服务器错误
        if (/\b(?:500|502|503|504)\b/.test(message) || message.includes("server error")) {
            return new ModelError(ModelErrorType.ServerError, err.message, err, true);
        }

        // 网络相关错误
        if (
            message.includes("network")
            || message.includes("connection")
            || message.includes("socket")
            || message.includes("fetch failed")
            || message.includes("econnreset")
            || ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "ERR_NETWORK"].some((k) => code.includes(k))
        ) {
            return new ModelError(ModelErrorType.NetworkError, err.message, err, true);
        }

        // 认证错误 (不可重试)
        if (
            message.includes("auth")
            || message.includes("unauthorized")
            || /\b401\b/.test(message)
            || /\b403\b/.test(message)
            || message.includes("api key")
        ) {
            return new ModelError(ModelErrorType.AuthenticationError, err.message, err, false);
        }

        // 内容过滤 (不可重试)
        if (message.includes("content policy") || message.includes("filtered") || message.includes("safety setting")) {
            return new ModelError(ModelErrorType.ContentFilterError, err.message, err, false);
        }

        // 请求参数错误 (不可重试)
        if (message.includes("invalid") || message.includes("bad request") || /\b400\b/.test(message)) {
            return new ModelError(ModelErrorType.InvalidRequestError, err.message, err, false);
        }

        // 配额超限 (不可重试)
        if (message.includes("quota") || message.includes("exceeded") || message.includes("insufficient_quota")) {
            return new ModelError(ModelErrorType.QuotaExceededError, err.message, err, false);
        }

        // 默认未知错误，认为是可重试的，因为可能是临时性问题
        return new ModelError(ModelErrorType.UnknownError, err.message, err, true);
    }
}

/**
 * 熔断器状态
 * - CLOSED: 正常状态，允许请求
 * - OPEN: 熔断状态，拒绝请求，等待恢复
 * - HALF_OPEN: 半开状态，允许一个探测请求
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ModelStatus {
    /** 熔断器当前状态 */
    circuitState: CircuitState;
    /** 连续失败次数 (用于触发熔断) */
    failureCount: number;
    /** 最后一次失败时间 */
    lastFailureTime?: number;
    /** 最后一次成功时间 */
    lastSuccessTime?: number;
    /** 平均响应延迟(ms)，使用指数移动平均计算 */
    averageLatency: number;
    /** 总请求数 */
    totalRequests: number;
    /** 成功请求数 */
    successRequests: number;
    /** 成功率 */
    successRate: number;
    /** 模型权重 (用于加权策略) */
    weight: number;
    /** 熔断恢复时间点 (当状态为 OPEN 时) */
    openUntil?: number;
}
