import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const { Schema } = await import("@koishijs/core");
  const { default: h } = await import("@satorijs/element");
  return { Context: class {}, Logger: class {}, Schema, h };
});

import CommandBridgePlugin from "../src/index.js";
import type { CommandBridgeConfig } from "../src/types.js";

function createConfig(overrides: Partial<CommandBridgeConfig> = {}): CommandBridgeConfig {
  return {
    trustMode: "locked",
    allowCommands: ["weather"],
    hardDeny: ["yesimbot", "koishi.execute", "koishi.execute.abort", "koishi.prompt.answer"],
    agentAuthority: 0,
    agentPermissions: [],
    userActor: "disabled",
    crossChannel: false,
    timeoutMs: 30_000,
    maxTranscriptChars: 20_000,
    ...overrides,
  };
}

describe("CommandBridgePlugin", () => {
  it("registers agent plugin and exposes bridge tools", async () => {
    const use = vi.fn(() => vi.fn());
    const ctx = {
      logger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() })),
      on: vi.fn(),
      permissions: { list: () => ["command:weather"] },
      yesimbot: { agent: { use } },
    };

    const plugin = new CommandBridgePlugin(ctx as never, createConfig() as never);
    await plugin.start();
    expect(use).toHaveBeenCalledOnce();

    const agent = await plugin.setup(
      { type: "shared", platform: "test", channelId: "room" },
      { platform: "test", selfId: "bot" } as never,
    );
    const tools = agent.tools ? await agent.tools({} as never) : [];
    expect(tools.map((tool) => tool.name)).toEqual([
      "koishi.execute.list",
      "koishi.execute",
      "koishi.prompt.answer",
      "koishi.execute.abort",
    ]);

    await plugin.stop();
  });

  it("lists only commands allowed by the locked policy", async () => {
    const ctx = {
      logger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() })),
      on: vi.fn(),
      permissions: { list: () => ["command:weather"] },
      yesimbot: { agent: { use: vi.fn(() => vi.fn()) } },
      $commander: {
        _commandList: [
          {
            parent: null,
            displayName: "weather",
            _aliases: {},
            toJSON: () => ({ name: "weather", description: { zh: "天气" }, children: [] }),
          },
          {
            parent: null,
            displayName: "lottery",
            _aliases: {},
            toJSON: () => ({ name: "lottery", description: { zh: "抽卡" }, children: [] }),
          },
        ],
      },
    };
    const plugin = new CommandBridgePlugin(ctx as never, createConfig() as never);
    const tools = plugin.createTools(
      { type: "shared", platform: "test", channelId: "room" },
      { platform: "test", selfId: "bot" } as never,
    );
    const listTool = tools.find((tool) => tool.name === "koishi.execute.list");
    expect(listTool).toBeDefined();

    const output = await listTool!.execute({} as never);
    expect(String(output)).toContain("weather");
    expect(String(output)).not.toContain("lottery");
  });
});
