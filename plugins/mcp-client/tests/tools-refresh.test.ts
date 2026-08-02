import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectMcpServer: vi.fn<() => Promise<unknown>>(),
  schema: {
    array: vi.fn<() => unknown>(),
    const: vi.fn<() => unknown>(),
    dict: vi.fn<() => unknown>(),
    intersect: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    string: vi.fn<() => unknown>(),
    union: vi.fn<() => unknown>(),
  },
}));

vi.mock("../src/transports", () => ({
  connectMcpServer: mocks.connectMcpServer,
}));

vi.mock("koishi", () => {
  const chain = () => ({
    collapse: vi.fn<() => unknown>().mockReturnThis(),
    default: vi.fn<() => unknown>().mockReturnThis(),
    description: vi.fn<() => unknown>().mockReturnThis(),
    required: vi.fn<() => unknown>().mockReturnThis(),
    role: vi.fn<() => unknown>().mockReturnThis(),
  });
  for (const key of Object.keys(mocks.schema) as Array<keyof typeof mocks.schema>) {
    mocks.schema[key].mockImplementation(chain);
  }
  return {
    Context: class Context {},
    Logger: class Logger {},
    Schema: mocks.schema,
  };
});

import McpClientPlugin from "../src/index";

type ToolListChangedHandler = () => unknown;

function createLogger() {
  return {
    debug: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
    success: vi.fn<() => void>(),
    warn: vi.fn<() => void>(),
  };
}

function createContext() {
  const scopedLogger = createLogger();
  const rootLogger = Object.assign(
    vi.fn<() => ReturnType<typeof createLogger>>(() => scopedLogger),
    createLogger(),
  );
  const factories: Array<() => AgentPlugin> = [];
  const disposers: Array<ReturnType<typeof vi.fn<() => void>>> = [];
  const ctx = {
    logger: rootLogger,
    on: vi.fn<() => void>(),
    yesimbot: {
      registerAgentPlugin: vi.fn<(factory: () => AgentPlugin) => () => void>((factory) => {
        factories.push(factory);
        const dispose = vi.fn<() => void>();
        disposers.push(dispose);
        return dispose;
      }),
    },
  };

  return { ctx, disposers, factories };
}

function createClient(toolBatches: string[][]) {
  let batchIndex = 0;
  let toolListChanged: ToolListChangedHandler | undefined;
  const client = {
    callTool: vi.fn<() => Promise<unknown>>(),
    close: vi.fn<() => Promise<void>>(),
    listTools: vi.fn<
      () => Promise<{
        tools: Array<{ name: string; description: string; inputSchema: { type: string } }>;
      }>
    >(async () => {
      const names = toolBatches[Math.min(batchIndex, toolBatches.length - 1)] ?? [];
      batchIndex += 1;
      return {
        tools: names.map((name) => ({
          name,
          description: `${name} description`,
          inputSchema: { type: "object" },
        })),
      };
    }),
    setNotificationHandler: vi.fn<(schema: unknown, handler: ToolListChangedHandler) => void>((_schema, handler) => {
      toolListChanged = handler;
    }),
  };

  return {
    client,
    async emitToolListChanged() {
      if (!toolListChanged) {
        throw new Error("tool list changed handler not registered");
      }
      await toolListChanged();
    },
  };
}

async function resolveToolNames(plugin: AgentPlugin): Promise<string[]> {
  const tools = typeof plugin.tools === "function" ? await plugin.tools({} as never) : plugin.tools;
  return tools?.map((tool) => tool.name) ?? [];
}

describe("mcp-client tool registry", () => {
  it("refreshes stable tools when a server reports tool list changes", async () => {
    const { client, emitToolListChanged } = createClient([["beta", "alpha"], ["gamma"]]);
    const { ctx, disposers, factories } = createContext();
    mocks.connectMcpServer.mockResolvedValueOnce({
      client,
      transport: { close: vi.fn<() => Promise<void>>() },
    });

    const plugin = new McpClientPlugin(ctx as never, {
      mcpServers: {
        docs: { type: "http", url: "https://example.test/mcp" },
      },
    });

    await plugin.start();

    expect(client.setNotificationHandler).toHaveBeenCalledOnce();
    expect(await resolveToolNames(factories[0]!())).toEqual(["docs-alpha", "docs-beta"]);

    await emitToolListChanged();

    expect(client.listTools).toHaveBeenCalledTimes(2);
    expect(disposers[0]).toHaveBeenCalledOnce();
    expect(ctx.yesimbot.registerAgentPlugin).toHaveBeenCalledTimes(2);
    expect(await resolveToolNames(factories[1]!())).toEqual(["docs-gamma"]);
  });
});
