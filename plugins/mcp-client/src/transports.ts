import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Context } from "koishi";

import type { McpClientTransport, McpHttpServer, McpServer, McpSseServer, McpStdioServer } from "./types.js";

export async function connectMcpServer(
  ctx: Context,
  name: string,
  server: McpServer,
): Promise<{ client: Client; transport: McpClientTransport }> {
  ctx.logger.info(`连接到 MCP 服务器 ${name}...`);

  switch (server.type) {
    case "stdio":
      return await connectToStdioServer(ctx, name, server);
    case "http":
      return await connectToHttpServer(ctx, name, server);
    case "sse":
      return await connectToSseServer(ctx, name, server);
  }
}

export function parseKeyValueString(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = input.split("\n");
  for (const line of lines) {
    const colon = line.indexOf(":");
    const equals = line.indexOf("=");
    const delimiter = colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals);
    if (delimiter > -1) {
      const key = line.slice(0, delimiter).trim();
      if (!key) continue;
      result[key] = line.slice(delimiter + 1).trim();
    }
  }
  return result;
}

async function connectToStdioServer(
  ctx: Context,
  name: string,
  server: McpStdioServer,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  ctx.logger.info(`连接到 STDIO 服务器 ${name}，命令: ${server.command} ${server.args?.join(" ")}`);

  const env = typeof server.env === "string" ? parseKeyValueString(server.env) : server.env;
  ctx.logger.debug(`环境变量: ${JSON.stringify(env)}`);

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env,
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}

async function connectToHttpServer(
  ctx: Context,
  name: string,
  server: McpHttpServer,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  return connectToRemoteServer(ctx, name, "HTTP", server, StreamableHTTPClientTransport);
}

async function connectToSseServer(
  ctx: Context,
  name: string,
  server: McpSseServer,
): Promise<{ client: Client; transport: SSEClientTransport }> {
  return connectToRemoteServer(ctx, name, "SSE", server, SSEClientTransport);
}

async function connectToRemoteServer<TTransport extends StreamableHTTPClientTransport | SSEClientTransport>(
  ctx: Context,
  name: string,
  protocol: "HTTP" | "SSE",
  server: McpHttpServer | McpSseServer,
  Transport: new (url: URL, options: { requestInit: { headers: Record<string, string> } }) => TTransport,
): Promise<{ client: Client; transport: TTransport }> {
  ctx.logger.info(`连接到 ${protocol} 服务器 ${name}，URL: ${server.url}`);
  const headers = typeof server.headers === "string" ? parseKeyValueString(server.headers) : server.headers || {};
  ctx.logger.debug(`HTTP 请求头: ${JSON.stringify(headers)}`);

  const transport = new Transport(new URL(server.url), {
    requestInit: {
      headers,
    },
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}
