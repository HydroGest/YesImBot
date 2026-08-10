import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectMcpServer: vi.fn<() => Promise<unknown>>(),
  schema: {
    array: vi.fn<() => unknown>(),
    boolean: vi.fn<() => unknown>(),
    const: vi.fn<() => unknown>(),
    dict: vi.fn<() => unknown>(),
    intersect: vi.fn<() => unknown>(),
    object: vi.fn<() => unknown>(),
    string: vi.fn<() => unknown>(),
    union: vi.fn<() => unknown>(),
  },
}));

vi.mock("../src/transports", () => ({ connectMcpServer: mocks.connectMcpServer }));

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
  return { Context: class Context {}, Logger: class Logger {}, Schema: mocks.schema };
});

import McpClientPlugin from "../src/index";

const PNG_BASE64 = "iVBORw0KGgo="; // decodes to a tiny PNG header

type ArtifactWriter = { readonly put: ReturnType<typeof vi.fn> };

function createContext() {
  const scopedLogger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn() };
  const rootLogger = Object.assign(
    vi.fn(() => scopedLogger),
    scopedLogger,
  );
  const plugins: AgentPlugin[] = [];
  const disposers: Array<() => void> = [];
  const artifactPut = vi.fn(async (bytes: Uint8Array, metadata: { mediaType?: string; filename?: string }) => {
    void bytes;
    void metadata;
    return "artifact://tools-snap/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4";
  });
  const artifactForTool = vi.fn(() => ({ put: artifactPut }));
  const ctx = {
    logger: rootLogger,
    on: vi.fn(),
    yesimbot: {
      agent: {
        use: vi.fn((plugin: AgentPlugin) => {
          plugins.push(plugin);
          const dispose = vi.fn();
          disposers.push(dispose);
          return dispose;
        }),
      },
      resource: { get: vi.fn(async () => ({ path: "/tmp", assets: {}, artifacts: { forTool: artifactForTool } })) },
    },
  };
  return { ctx, disposers, plugins, artifactForTool, artifactPut };
}

function createClient() {
  return {
    callTool: vi.fn(),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({ tools: [{ name: "snap", description: "take a screenshot", inputSchema: { type: "object" } }] })),
    setNotificationHandler: vi.fn(),
  };
}

async function buildPlugin() {
  const { ctx, plugins, artifactForTool, artifactPut } = createContext();
  const client = createClient();
  mocks.connectMcpServer.mockResolvedValueOnce({ client, transport: { close: vi.fn(async () => undefined) } });
  const plugin = new McpClientPlugin(ctx as never, { mcpServers: { tools: { type: "http", url: "https://example.test/mcp" } } });
  await plugin.start();
  const agentPlugin = await plugins[0]!.setup({ type: "guild", platform: "test", channelId: "room", guildId: "room" } as never, {} as never);
  if (!agentPlugin) throw new Error("MCP runtime plugin was not created");
  return { client, agentPlugin, artifactForTool, artifactPut };
}

describe("McpClientPlugin media outputs", () => {
  it("persists supported inline images as artifact references", async () => {
    const { client, agentPlugin, artifactForTool, artifactPut } = await buildPlugin();
    client.callTool.mockResolvedValueOnce({ content: [{ type: "image", data: PNG_BASE64, mimeType: "image/png" }] });

    const tool = agentPlugin.tools![0]!;
    const output = await tool.execute({}, {} as never);

    if (typeof tool.toModelOutput !== "function") throw new Error("toModelOutput unavailable");
    const modelOutput = await tool.toModelOutput({ output, toolCallId: "call-1" });

    expect(modelOutput).toMatchObject({ type: "text" });
    const value = (modelOutput as { value: string }).value;
    expect(value).toContain("artifact://tools-snap/019d3b7e-1bd0-7e4f-9c5d-5bf3fd41f1d4");
    expect(value).not.toContain("iVBORw0KGgo");
    expect(value).not.toContain("base64");
    expect(artifactForTool).toHaveBeenCalledWith("tools-snap");
    const [bytes, metadata] = artifactPut.mock.calls[0]!;
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(metadata).toEqual({ mediaType: "image/png", filename: "mcp-image" });
  });
  it("bounds inline image persistence to Core image limits", async () => {
    const { client, agentPlugin, artifactPut } = await buildPlugin();
    const image = { type: "image", data: PNG_BASE64, mimeType: "image/png" };
    client.callTool.mockResolvedValueOnce({ content: [image, image, image, image, image] });

    const tool = agentPlugin.tools![0]!;
    const output = await tool.execute({}, {} as never);
    if (typeof tool.toModelOutput !== "function") throw new Error("toModelOutput unavailable");
    const modelOutput = await tool.toModelOutput({ output, toolCallId: "call-1" });

    expect(artifactPut).toHaveBeenCalledTimes(4);
    expect(modelOutput).toMatchObject({ type: "text", value: expect.stringContaining("超出图片限制") });
  });

  it("returns bounded descriptions for unknown blocks without JSON.stringify", async () => {
    const { client, agentPlugin } = await buildPlugin();
    client.callTool.mockResolvedValueOnce({ content: [{ type: "resource", uri: "https://example.test/file.pdf", text: "not readable" }] });

    const tool = agentPlugin.tools![0]!;
    const output = await tool.execute({}, {} as never);
    if (typeof tool.toModelOutput !== "function") throw new Error("toModelOutput unavailable");
    const modelOutput = await tool.toModelOutput({ output, toolCallId: "call-1" });

    const value = (modelOutput as { value: string }).value;
    expect(value).toContain("不支持的内容块");
    expect(value).not.toContain("https://example.test");
  });

  it("keeps remote tool descriptions untouched and adds one prompt block", async () => {
    const { agentPlugin } = await buildPlugin();

    expect(agentPlugin.tools![0]!.description).toBe("take a screenshot");
    if (typeof agentPlugin.appendSystemPrompt !== "function") throw new Error("appendSystemPrompt unavailable");
    const prompt = await agentPlugin.appendSystemPrompt({} as never);
    expect(String(prompt)).toContain("artifact://");
    expect(String(prompt)).toContain("read");
  });
});
