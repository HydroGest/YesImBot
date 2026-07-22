import { encode } from "@toon-format/toon";
import type { AgentPlugin, ToolCallContext, ToolResultContext } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type { AgentPluginFactory } from "koishi-plugin-yesimbot";

import { formatPreview, isJsonLike, redactJsonLike } from "./format.js";
import { sendToolObserverMessage } from "./send.js";

export interface ToolObserverConfig {
  enabled?: boolean;
  displayArgs?: boolean;
  displayResult?: boolean;
  displayMaxChars?: number;
  ignoredTools?: string[];
  redactKeys?: string[];
  compressJsonToolResults?: boolean;
  compressedResultMaxChars?: number;
  sendTimeoutMs?: number;
}

const DEFAULT_IGNORED_TOOLS = ["finalize_response"];
const DEFAULT_REDACT_KEYS = ["apiKey", "authorization", "password", "secret", "token"];

type ResolvedConfig = Required<ToolObserverConfig>;

export default class ToolObserverPlugin {
  static name = "yesimbot-tool-observer";
  static inject = ["yesimbot"];
  static usage = "工具调用观察插件，向聊天窗口展示工具调用摘要";
  static Config: Schema<ToolObserverConfig> = Schema.object({
    enabled: Schema.boolean().default(true).description("启用工具调用观察"),
    displayArgs: Schema.boolean().default(true).description("展示工具参数概览"),
    displayResult: Schema.boolean().default(true).description("展示工具结果概览"),
    displayMaxChars: Schema.number().default(1200).description("聊天展示的单段最大字符数"),
    ignoredTools: Schema.array(Schema.string())
      .default(DEFAULT_IGNORED_TOOLS)
      .description("不展示的工具名"),
    redactKeys: Schema.array(Schema.string())
      .default(DEFAULT_REDACT_KEYS)
      .description("需要隐藏的参数或结果字段名"),
    compressJsonToolResults: Schema.boolean()
      .default(false)
      .description("将 JSON-like 工具结果压缩为 TOON 字符串后返回给模型"),
    compressedResultMaxChars: Schema.number().default(8000).description("压缩结果最大字符数"),
    sendTimeoutMs: Schema.number().default(5000).description("发送观察消息的超时时间"),
  });

  public readonly ctx: Context;
  public readonly config: ResolvedConfig;
  public readonly logger: Logger;

  private disposeAgentPlugin?: () => void;

  constructor(ctx: Context, config: ToolObserverConfig) {
    this.ctx = ctx;
    this.config = resolveConfig(config);
    this.logger = ctx.logger("yesimbot.tool-observer");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  async start(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;

    if (!this.config.enabled) {
      return;
    }

    const factory: AgentPluginFactory = ({ channel, bot }) => {
      const calls = new Map<string, number>();

      return {
        name: "tool-observer",
        beforeToolCall: (call: ToolCallContext) => {
          calls.set(call.toolCallId, Date.now());
        },
        afterToolCall: async (result: ToolResultContext) => {
          if (isIgnored(result.toolName, this.config.ignoredTools)) {
            calls.delete(result.toolCallId);
            return undefined;
          }

          const startedAt = calls.get(result.toolCallId);
          calls.delete(result.toolCallId);
          const elapsedMs = startedAt ? Date.now() - startedAt : 0;

          const message = buildNotification({
            toolName: result.toolName,
            status: result.isError ? "error" : "success",
            elapsedMs,
            args: result.args,
            result: result.result,
            config: this.config,
          });

          try {
            await sendToolObserverMessage(
              bot,
              channel.channelId,
              message,
              this.config.sendTimeoutMs,
            );
          } catch (error) {
            this.logger.warn(
              `Tool observer notification failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          return createCompressedResult(result, this.config);
        },
        onTurnFinish: () => {
          calls.clear();
        },
      } satisfies AgentPlugin;
    };
    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin(factory);
  }

  async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
  }
}

function resolveConfig(config: ToolObserverConfig): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    displayArgs: config.displayArgs ?? true,
    displayResult: config.displayResult ?? true,
    displayMaxChars: config.displayMaxChars ?? 1200,
    ignoredTools: config.ignoredTools ?? DEFAULT_IGNORED_TOOLS,
    redactKeys: config.redactKeys ?? DEFAULT_REDACT_KEYS,
    compressJsonToolResults: config.compressJsonToolResults ?? false,
    compressedResultMaxChars: config.compressedResultMaxChars ?? 8000,
    sendTimeoutMs: config.sendTimeoutMs ?? 5000,
  };
}

function isIgnored(toolName: string, ignoredTools: readonly string[]): boolean {
  return ignoredTools.includes(toolName);
}

function buildNotification(options: {
  toolName: string;
  status: "success" | "error";
  elapsedMs: number;
  args: unknown;
  result: unknown;
  config: ResolvedConfig;
}): string {
  const lines = [
    `Tool call: ${options.toolName}`,
    `status: ${options.status}`,
    `elapsedMs: ${options.elapsedMs}`,
  ];

  if (options.config.displayArgs) {
    lines.push(
      "",
      "args:",
      formatPreview(options.args, {
        maxChars: options.config.displayMaxChars,
        redactKeys: options.config.redactKeys,
      }),
    );
  }

  if (options.config.displayResult) {
    lines.push(
      "",
      "result:",
      formatPreview(options.result, {
        maxChars: options.config.displayMaxChars,
        redactKeys: options.config.redactKeys,
      }),
    );
  }

  return lines.join("\n");
}

function createCompressedResult(
  result: ToolResultContext,
  config: ResolvedConfig,
): { result: string } | undefined {
  if (!config.compressJsonToolResults || result.isError || !isJsonLike(result.result)) {
    return undefined;
  }

  const compressed = encode(redactJsonLike(result.result, config.redactKeys));
  if (compressed.length <= config.compressedResultMaxChars) {
    return { result: compressed };
  }

  return {
    result: `${compressed.slice(0, Math.max(0, config.compressedResultMaxChars - 15))}...\n[truncated]`,
  };
}
