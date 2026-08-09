import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const { Schema } = await import("@koishijs/core");
  return { Context: class {}, Logger: class {}, Schema };
});

import WorkspacePlugin from "../src/index.js";
import type { WorkspacePluginConfig } from "../src/types.js";

async function createWorkspace() {
  const baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-test-"));
  const plugins: WorkspacePlugin[] = [];
  const readers: Array<{ scheme: string; setup: (...args: never[]) => unknown }> = [];
  const disposeAgent = vi.fn();
  const disposeReader = vi.fn();
  const ctx = {
    baseDir,
    logger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(), debug: vi.fn() })),
    on: vi.fn(),
    yesimbot: {
      agent: {
        use: vi.fn((plugin: WorkspacePlugin) => {
          plugins.push(plugin);
          return disposeAgent;
        }),
      },
      resource: {
        use: vi.fn((reader: { scheme: string; setup: (...args: never[]) => unknown }) => {
          readers.push(reader);
          return disposeReader;
        }),
        get: vi.fn(async () => ({ path: baseDir, assets: {}, artifacts: {} })),
      },
    },
  };
  const config: WorkspacePluginConfig = { bash: { cwd: baseDir, timeoutMs: 1000, enableNetwork: false, mounts: [] } };
  const plugin = new WorkspacePlugin(ctx as never, config);
  return { baseDir, ctx, config, disposeAgent, disposeReader, plugin, plugins, readers };
}

describe("WorkspacePlugin", () => {
  it("registers named ResourceReader objects and one agent plugin on start", async () => {
    const fixture = await createWorkspace();
    try {
      await fixture.plugin.start();

      expect(fixture.ctx.yesimbot.agent.use).toHaveBeenCalledOnce();
      expect(fixture.plugins).toHaveLength(1);
      expect(fixture.ctx.yesimbot.resource.use).toHaveBeenCalledOnce();
      expect(fixture.readers.map((reader) => reader.scheme)).toEqual(["workspace"]);
    } finally {
      await fixture.plugin.stop();
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it("initializes a channel-scoped workspace agent through resource.get", async () => {
    const fixture = await createWorkspace();
    try {
      await fixture.plugin.start();
      const agentPlugin = await fixture.plugins[0]!.setup({ type: "shared", platform: "test", channelId: "room" }, { selfId: "bot" } as never);

      expect(agentPlugin).toBeTruthy();
      expect(fixture.ctx.yesimbot.resource.get).toHaveBeenCalledWith({ type: "shared", platform: "test", channelId: "room" });
      const tools = typeof agentPlugin?.tools === "function" ? ((await agentPlugin.tools({} as never)) ?? []) : [];
      expect(tools.map((tool) => tool.name)).toEqual(["bash", "readFile", "writeFile"]);
    } finally {
      await fixture.plugin.stop();
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });

  it("only provides the sandbox virtual filesystem backend", async () => {
    const fixture = await createWorkspace();
    try {
      await fixture.plugin.start();
      const agentPlugin = await fixture.plugins[0]!.setup({ type: "shared", platform: "test", channelId: "room" }, { selfId: "bot" } as never);
      const tools = typeof agentPlugin?.tools === "function" ? ((await agentPlugin.tools({} as never)) ?? []) : [];

      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
    } finally {
      await fixture.plugin.stop();
      await rm(fixture.baseDir, { recursive: true, force: true });
    }
  });
});
