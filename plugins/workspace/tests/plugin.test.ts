import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => ({
  Context: class {},
  Logger: class {},
  Schema: {
    object: (value: unknown) => value,
    path: () => ({ default() { return this; }, description() { return this; } }),
    string: () => ({ default() { return this; }, description() { return this; } }),
    dict: () => ({ description() { return this; } }),
    number: () => ({ default() { return this; }, description() { return this; } }),
    boolean: () => ({ default() { return this; }, description() { return this; } }),
  },
}));

import WorkspacePlugin from "../src";

async function tools(plugin: AgentPlugin): Promise<readonly AgentTool[]> {
  return typeof plugin.tools === "function" ? ((await plugin.tools({} as never)) ?? []) : (plugin.tools ?? []);
}

describe("WorkspacePlugin", () => {
  let baseDir = "";

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it("places its workspace below the Core channel root", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const ready: Array<() => Promise<void> | void> = [];
    const factories: Array<(scope: any, bot: any) => AgentPlugin> = [];
    const getStoragePath = vi.fn(async () => {
      const root = join(baseDir, "channels", "shared-onebot-room");
      await mkdir(root, { recursive: true });
      return root;
    });
    const ctx = {
      baseDir,
      logger: () => ({ info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
      on: vi.fn((event: string, callback: () => Promise<void> | void) => {
        if (event === "ready") ready.push(callback);
      }),
      yesimbot: {
        getStoragePath,
        registerAgentPlugin: vi.fn((factory) => {
          factories.push(factory);
          return vi.fn();
        }),
      },
    };
    const plugin = new WorkspacePlugin(ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await ready[0]?.();
    const scope = { platform: "onebot", selfId: "bot", channelId: "room", isDirect: false };
    const agentPlugin = factories[0]?.(scope, {});
    expect(agentPlugin).toBeDefined();
    expect((await tools(agentPlugin!)).map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
    expect(getStoragePath).toHaveBeenCalledWith(scope);
    expect((plugin as any).workspaces.get(JSON.stringify(["onebot", "room"])).config.root).toBe(
      join(baseDir, "channels", "shared-onebot-room", "workspace"),
    );
  });
});
