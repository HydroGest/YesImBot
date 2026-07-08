import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentTool, jsonSchema } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { connectMcpServer } from "./transports";
import type { McpClientConfig, McpClientTransport } from "./types";

export default class McpClientPlugin {
  static name = "yesimbot-mcp-client";
  static usage = "MCP 客户端插件，用于连接 MCP 服务器并注册工具";
  static inject = ["yesimbot"];
  static Config: Schema<McpClientConfig> = Schema.object({
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

  async start(): Promise<void> {
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
      this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin(() => {
        return {
          name: "mcp-client",
          tools: registeredTools,
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
          description: tool.description || "no description provided",
          inputSchema: jsonSchema(tool.inputSchema),
          execute: async (params: unknown) => {
            try {
              const result = await client.callTool({
                name: tool.name,
                arguments: structuredClone(params as Record<string, unknown>),
              });
              return result.content;
            } catch (error) {
              this.ctx.logger.error(`调用工具 ${tool.name} 失败: ${(error as Error).message}`);
              throw error;
            }
          },
        };
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

  async stop(): Promise<void> {
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
