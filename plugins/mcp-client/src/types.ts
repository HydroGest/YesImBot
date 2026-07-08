import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpStdioServer {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string> | string;
}

export interface McpHttpServer {
  type: "http";
  url: string;
  headers?: Record<string, string> | string;
}

export interface McpSseServer {
  type: "sse";
  url: string;
  headers?: Record<string, string> | string;
}

export type McpServer = McpStdioServer | McpHttpServer | McpSseServer;

export type McpClientTransport =
  | StdioClientTransport
  | StreamableHTTPClientTransport
  | SSEClientTransport;

export interface McpClientConfig {
  mcpServers: Record<string, McpServer>;
}
