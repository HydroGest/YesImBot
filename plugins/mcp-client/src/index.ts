import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type { ArtifactStore } from "koishi-plugin-yesimbot";
import type {} from "koishi-plugin-yesimbot";

import { connectMcpServer } from "./transports.js";
import type { McpClientConfig, McpClientTransport } from "./types.js";

interface McpToolOutputBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/** ponytail: align MCP media with Core's default image-input budget. */
const MCP_IMAGE_MAX_COUNT = 4;
const MCP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MCP_IMAGE_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MCP_MAX_OUTPUT_CHARS = 30_000;
const MCP_MAX_BLOCK_TYPE_CHARS = 64;
const SUPPORTED_IMAGE_MIMES: Record<string, true> = {
  "image/jpeg": true,
  "image/png": true,
  "image/gif": true,
  "image/webp": true,
};

const MCP_ARTIFACT_GUIDANCE =
  "MCP 工具可能返回 artifact:// 媒体引用。这些是工具产生的不可变工件，不是内联媒体；" +
  "需要媒体内容时请调用 Core 的 read 工具。媒体不会是 Base64，远端 URL 也不会被自动下载。";

export default class McpClientPlugin {
  public static name = "yesimbot-mcp-client";
  public static usage = "MCP 客户端插件，用于连接 MCP 服务器并注册工具";
  public static inject = ["yesimbot"];
  public static Config: Schema<McpClientConfig> = Schema.object({
    mcpServers: Schema.dict(
      Schema.intersect([
        Schema.object({
          type: Schema.union(["stdio", "http", "sse"]),
        }),
        Schema.union([
          Schema.object({
            type: Schema.const("stdio").required(),
            command: Schema.string().required(),
            args: Schema.array(Schema.string()).default([]).role("table"),
            env: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY=VALUE，每行一个"),
            ]).description("环境变量"),
          }),
          Schema.object({
            type: Schema.const("http").required(),
            url: Schema.string().required(),
            headers: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY: VALUE，每行一个"),
            ]).description("HTTP 请求头"),
          }),
          Schema.object({
            type: Schema.const("sse").required(),
            url: Schema.string().required(),
            headers: Schema.union([
              Schema.dict(Schema.string()).default({}).role("table").description("字典"),
              Schema.string().role("textarea").description("字符串，格式为 KEY: VALUE，每行一个"),
            ]).description("HTTP 请求头"),
          }),
        ]),
      ]).collapse(true),
    ),
  });

  public readonly ctx: Context;
  public readonly config: McpClientConfig;
  public readonly logger: Logger;

  private transports: Map<string, McpClientTransport> = new Map();
  private clients: Map<string, Client> = new Map();
  private disposeAgentPlugin?: () => void;
  constructor(ctx: Context, config: McpClientConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("mcp-client");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.ctx.logger.info("初始化 MCP 客户端...");
    for (const [name, server] of Object.entries(this.config.mcpServers)) {
      try {
        const { client, transport } = await connectMcpServer(this.ctx, name, server);
        this.transports.set(name, transport);
        this.clients.set(name, client);
        this.ctx.logger.success(`成功连接到 MCP 服务器 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`连接到 MCP 服务器 ${name} 失败: ${(error as Error).message}`);
      }
    }

    const registry = new Map<string, { client: Client; tools: Record<string, AgentTool> }>();
    let registeredTools: AgentTool[] = [];

    const publishAgentPlugin = () => {
      registeredTools = [...registry.values()]
        .flatMap(({ tools }) => Object.values(tools))
        .sort((left, right) => left.name.localeCompare(right.name));

      for (const tool of registeredTools) {
        this.logger.info(`注册工具 ${tool.name}`);
      }

      this.disposeAgentPlugin?.();
      this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin((context) => {
        const channelTools = registeredTools.map((tool) => wrapToolWithArtifacts(tool, context.artifacts));
        return {
          name: "mcp-client",
          tools: channelTools,
          appendSystemPrompt: () => MCP_ARTIFACT_GUIDANCE,
        };
      });
    };

    const refreshServerTools = async (name: string, client: Client) => {
      const resp = await client.listTools();
      const tools = resp.tools;
      this.ctx.logger.info(`MCP 服务器 ${name} 提供的工具: ${tools.map((t) => t.name).join(", ")}`);
      const toolDefs: Record<string, AgentTool> = {};
      for (const tool of tools) {
        toolDefs[tool.name] = {
          name: `${name}-${tool.name}`,
          description: tool.description,
          inputSchema: jsonSchema(tool.inputSchema),
          execute: async (params: unknown) => {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: structuredClone(params as Record<string, unknown>),
              });
              return result.content as Array<McpToolOutputBlock>;
            } catch (error) {
              this.ctx.logger.error(`调用工具 ${tool.name} 失败: ${(error as Error).message}`);
              throw error;
            }
          },
        } satisfies AgentTool;
      }
      registry.set(name, { client, tools: toolDefs });
    };

    this.ctx.logger.info("注册 MCP 客户端工具...");
    for (const [name, client] of this.clients.entries()) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        try {
          await refreshServerTools(name, client);
          publishAgentPlugin();
        } catch (error) {
          this.ctx.logger.error(
            `刷新 MCP 服务器 ${name} 工具失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
      await refreshServerTools(name, client);
    }

    publishAgentPlugin();

    this.ctx.logger.success("MCP 客户端初始化完成");
  }

  public async stop(): Promise<void> {
    this.ctx.logger.info("清理 MCP 客户端...");
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close();
        this.ctx.logger.success(`成功断开 MCP 服务器 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`断开 MCP 服务器 ${name} 失败: ${(error as Error).message}`);
      }
    }
    for (const [name, transport] of this.transports.entries()) {
      try {
        await transport.close();
        this.ctx.logger.success(`成功关闭传输 ${name}`);
      } catch (error) {
        this.ctx.logger.error(`关闭传输 ${name} 失败: ${(error as Error).message}`);
      }
    }
    this.clients.clear();
    this.transports.clear();
    this.ctx.logger.success("MCP 客户端已清理");
  }
}

function wrapToolWithArtifacts(tool: AgentTool, artifacts: ArtifactStore): AgentTool {
  const writer = artifacts.forTool(tool.name);
  return {
    ...tool,
    toModelOutput: async (options) => {
      const { output } = options as { output: Array<McpToolOutputBlock> };
      if (!output || output.length === 0) {
        return { type: "text" as const, value: "" };
      }

      const lines: string[] = [];
      let imageCount = 0;
      let imageBytes = 0;
      for (const block of output) {
        if (!block || typeof block !== "object") {
          lines.push("[不支持的内容块：unknown]");
          continue;
        }
        if (block.type === "text") {
          lines.push(block.text ?? "");
          continue;
        }

        const mediaType = typeof block.mimeType === "string" ? block.mimeType.toLowerCase() : undefined;
        if (
          block.type === "image" &&
          typeof block.data === "string" &&
          mediaType !== undefined &&
          SUPPORTED_IMAGE_MIMES[mediaType]
        ) {
          const bytes = decodeInlineImage(block.data);
          if (!bytes) {
            lines.push("[图片资源：数据无效或大小超出限制]");
            continue;
          }
          if (imageCount >= MCP_IMAGE_MAX_COUNT || imageBytes + bytes.byteLength > MCP_IMAGE_MAX_TOTAL_BYTES) {
            lines.push("[图片资源：超出图片限制]");
            continue;
          }
          try {
            const uri = await writer.put(bytes, {
              mediaType,
              filename: "mcp-image",
            });
            imageCount += 1;
            imageBytes += bytes.byteLength;
            lines.push(`[图片：${uri}（${mediaType}，${formatBytes(bytes.byteLength)}）]`);
          } catch {
            lines.push("[图片资源：持久化失败]");
          }
          continue;
        }
        // Unknown or unsupported blocks become bounded descriptions, never opaque JSON.
        lines.push(`[不支持的内容块：${describeBlockType(block.type)}]`);
      }

      const value = lines.join("\n").trim().slice(0, MCP_MAX_OUTPUT_CHARS);
      return { type: "text" as const, value };
    },
  };
}

function decodeInlineImage(data: string): Uint8Array | null {
  if (data.length === 0 || data.length > Math.ceil(MCP_IMAGE_MAX_BYTES / 3) * 4) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
  const bytes = Buffer.from(data, "base64");
  return bytes.byteLength > 0 && bytes.byteLength <= MCP_IMAGE_MAX_BYTES ? bytes : null;
}

function describeBlockType(type: string): string {
  return type.length > MCP_MAX_BLOCK_TYPE_CHARS ? `${type.slice(0, MCP_MAX_BLOCK_TYPE_CHARS)}…` : type;
}

function formatBytes(length: number): string {
  if (length >= 1024 * 1024) return `${(length / (1024 * 1024)).toFixed(1)} MiB`;
  if (length >= 1024) return `${(length / 1024).toFixed(1)} KiB`;
  return `${length} B`;
}
