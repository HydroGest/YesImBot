import { mkdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChannelScopeId } from "koishi-plugin-yesimbot";

vi.mock("koishi", () => ({
  Context: class {},
  Logger: class {},
  Schema: {
    object: (value: unknown) => value,
    path: () => ({
      default() {
        return this;
      },
      description() {
        return this;
      },
    }),
    string: () => ({
      default() {
        return this;
      },
      description() {
        return this;
      },
    }),
    dict: () => ({
      description() {
        return this;
      },
    }),
    number: () => ({
      default() {
        return this;
      },
      description() {
        return this;
      },
    }),
    boolean: () => ({
      default() {
        return this;
      },
      description() {
        return this;
      },
    }),
  },
}));

const mockCreateChannelScopeId = vi.hoisted(() => {
  return (scope: { platform: string; selfId: string; channelId: string }) =>
    `ch_v1_mock_${scope.platform}_${scope.selfId}_${scope.channelId}` as const;
});

vi.mock("koishi-plugin-yesimbot", () => ({
  createChannelScopeId: mockCreateChannelScopeId,
}));

import WorkspacePlugin from "../src";

function createMockCtx(baseDir: string) {
  const readyHandlers: Array<() => Promise<void> | void> = [];
  const disposeHandlers: Array<() => Promise<void> | void> = [];
  const factories: Array<(context: never) => AgentPlugin> = [];

  return {
    ctx: {
      baseDir,
      logger: () => ({
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      on: vi.fn((event: string, handler: () => Promise<void> | void) => {
        if (event === "ready") readyHandlers.push(handler);
        if (event === "dispose") disposeHandlers.push(handler);
      }),
      yesimbot: {
        registerAgentPlugin: vi.fn((factory: (context: never) => AgentPlugin) => {
          factories.push(factory);
          return vi.fn();
        }),
      },
    },
    readyHandlers,
    disposeHandlers,
    factories,
  };
}

async function getTools(plugin: AgentPlugin): Promise<AgentTool[]> {
  if (typeof plugin.tools === "function") {
    return ((await plugin.tools({} as never)) ?? []) as AgentTool[];
  }
  return (plugin.tools ?? []) as AgentTool[];
}

describe("WorkspacePlugin", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-plugin-"));
    await mkdir(baseDir, { recursive: true });
  });

  it("registers bash-tool default tools for a channel", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const plugin = mocks.factories[0]?.({
      channel: { platform: "onebot", selfId: "bot", channelId: "a", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const tools = await getTools(plugin!);

    expect(tools.map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
  });

  it("isolates default workspace files by channel", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const factory = mocks.factories[0]!;
    const channelA = { platform: "onebot", selfId: "bot", channelId: "a", type: "text" } as const;
    const channelB = { platform: "onebot", selfId: "bot", channelId: "b", type: "text" } as const;
    const pluginA = factory({
      channel: channelA,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const pluginB = factory({
      channel: channelB,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);

    const writeA = (await getTools(pluginA)).find((tool) => tool.name === "writeFile");
    const readB = (await getTools(pluginB)).find((tool) => tool.name === "readFile");

    expect(writeA?.execute).toBeTypeOf("function");
    expect(readB?.execute).toBeTypeOf("function");

    await writeA!.execute!({ path: "note.txt", content: "channel-a" }, {} as never);
    await expect(readB!.execute!({ path: "note.txt" }, {} as never)).rejects.toThrow();
    await expect(
      access(
        join(
          baseDir,
          "workspace",
          "channels",
          createChannelScopeId(channelA),
          "workspace",
          "note.txt",
        ),
        constants.F_OK,
      ),
    ).resolves.toBeUndefined();
    await expect(
      access(
        join(
          baseDir,
          "workspace",
          "channels",
          createChannelScopeId(channelB),
          "workspace",
          "note.txt",
        ),
        constants.F_OK,
      ),
    ).rejects.toThrow();
  });

  it("extends prompt with sandbox and mount policy", async () => {
    await mkdir(join(baseDir, "shared"), { recursive: true });
    await mkdir(join(baseDir, "knowledge"), { recursive: true });
    await mkdir(join(baseDir, "repo"), { recursive: true });

    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      persistPaths: { "/shared": "shared" },
      readOnlyPaths: { "/knowledge": "knowledge" },
      overlayPaths: { "/repo": "repo" },
      timeoutMs: 5000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const plugin = mocks.factories[0]?.({
      channel: { platform: "onebot", selfId: "bot", channelId: "a", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);

    const prompt = await plugin?.appendSystemPrompt?.({} as never);
    const promptText = Array.isArray(prompt) ? prompt.join("\n") : String(prompt ?? "");

    expect(promptText).toContain("just-bash");
    expect(promptText).toContain("/home/workspace");
    expect(promptText).toContain("channel");
    expect(promptText).toContain("Network access: disabled");
    expect(promptText).toContain("Command timeout: 5000 ms");
    expect(promptText).toContain("/shared");
    expect(promptText).toContain("/knowledge");
    expect(promptText).toContain("/repo");
  });

  it("fails fast when a read-only mount host path does not exist", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      readOnlyPaths: { "/knowledge": "missing-knowledge" },
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await expect(mocks.readyHandlers[0]?.()).rejects.toThrow();
  });

  it("fails fast when an overlay mount host path does not exist", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      overlayPaths: { "/repo": "missing-repo" },
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await expect(mocks.readyHandlers[0]?.()).rejects.toThrow();
  });

  it("creates persist mount host paths automatically", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      persistPaths: { "/shared": "created/shared" },
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await expect(mocks.readyHandlers[0]?.()).resolves.toBeUndefined();
    await expect(access(join(baseDir, "created/shared"), constants.F_OK)).resolves.toBeUndefined();
  });
});
