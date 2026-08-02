import type { MemosAddMessageRequest, MemosApiResponse, MemosSearchMemoryRequest } from "./types.js";

export interface MemosHttpPostOptions {
  headers: Record<string, string>;
  timeout: number;
}

export interface MemosHttpPost {
  <T>(url: string, body: unknown, options: MemosHttpPostOptions): Promise<T>;
}

export interface MemosCloudClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  post: MemosHttpPost;
}

export class MemosCloudClientError extends Error {
  public readonly code: "api_error" | "invalid_response" | "network_error";
  public readonly endpoint: "searchMemory" | "addMessage";
  public readonly apiCode?: number;

  constructor(options: {
    code: "api_error" | "invalid_response" | "network_error";
    endpoint: "searchMemory" | "addMessage";
    message: string;
    apiCode?: number;
  }) {
    super(options.message);
    this.name = "MemosCloudClientError";
    this.code = options.code;
    this.endpoint = options.endpoint;
    this.apiCode = options.apiCode;
  }
}

export class MemosCloudClient {
  constructor(private readonly options: MemosCloudClientOptions) {}

  public searchMemory<TData = unknown>(body: MemosSearchMemoryRequest): Promise<MemosApiResponse<TData>> {
    return this.post<TData>("searchMemory", "/search/memory", body);
  }

  public addMessage<TData = unknown>(body: MemosAddMessageRequest): Promise<MemosApiResponse<TData>> {
    return this.post<TData>("addMessage", "/add/message", body);
  }

  private async post<TData>(
    endpoint: "searchMemory" | "addMessage",
    path: "/search/memory" | "/add/message",
    body: MemosSearchMemoryRequest | MemosAddMessageRequest,
  ): Promise<MemosApiResponse<TData>> {
    try {
      const response = await this.options.post<MemosApiResponse<TData>>(
        `${this.options.baseUrl.replace(/\/+$/, "")}${path}`,
        body,
        {
          headers: {
            Authorization: `Token ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: this.options.timeoutMs,
        },
      );

      if (!isObject(response) || typeof response.code !== "number") {
        throw new MemosCloudClientError({
          code: "invalid_response",
          endpoint,
          message: `MemOS ${endpoint} returned an invalid response.`,
        });
      }

      if (response.code !== 0) {
        throw new MemosCloudClientError({
          code: "api_error",
          endpoint,
          apiCode: response.code,
          message: `MemOS ${endpoint} failed with code ${response.code}: ${sanitizeMessage(
            typeof response.message === "string" && response.message.length > 0 ? response.message : "Unknown error.",
            this.options.apiKey,
          )}`,
        });
      }

      return response;
    } catch (error) {
      if (error instanceof MemosCloudClientError) {
        throw error;
      }

      throw new MemosCloudClientError({
        code: "network_error",
        endpoint,
        message: `MemOS ${endpoint} request failed: ${sanitizeMessage(
          error instanceof Error ? error.message : "Unknown error.",
          this.options.apiKey,
        )}`,
      });
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeMessage(message: string, apiKey: string): string {
  return message.replaceAll(`Token ${apiKey}`, "Token [REDACTED]").replaceAll(apiKey, "[REDACTED]");
}
