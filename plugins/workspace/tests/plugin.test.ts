import { constants } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import WorkspacePlugin from "../src";

function createMockCtx(baseDir: string) {
  const readyHandlers: Array<() => Promise<void> | void> = [];
  const disposeHandlers: Array<() => Promise<void> | void> = [];
  const factories: Array<(context: never) => AgentPlugin> = [];
  const channelKey = vi.fn(
    (scope: { platform: string; selfId: string; channelId: string }) =>
      `${scope.platform}:${scope.selfId}:${scope.channelId}`,
  );
  const ensureStorage = vi.fn(
    async (scope: { platform: string; selfId: string; channelId: string }) => {
      const path = join(baseDir, "channels", channelKey(scope), "workspace");
      await mkdir(path, { recursive: true });
      return path;
    },
  );
  const registerStorage = vi.fn(() => vi.fn());

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
        channelKey,
        ensureStorage,
        registerStorage,
        registerAgentPlugin: vi.fn((factory: (context: never) => AgentPlugin) => {
          factories.push(factory);
          return vi.fn();
        }),
      },
    },
    readyHandlers,
    disposeHandlers,
    factories,
    yesimbot: { channelKey, ensureStorage, registerStorage },
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

  it("registers workspace storage and uses the Core path", async () => {
    const mocks = createMockCtx(baseDir);
    const disposeStorage = vi.fn();
    mocks.yesimbot.registerStorage.mockReturnValue(disposeStorage);
    mocks.yesimbot.channelKey.mockReturnValue("a5vnf2ijd75c2ibyo2s5czdir4");
    mocks.yesimbot.ensureStorage.mockImplementation(async () => {
      const root = "/data/yesimbot/channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace";
      await mkdir(root, { recursive: true });
      return root;
    });
    const workspacePlugin = new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const sharedScope = { platform: "onebot", selfId: "bot", channelId: "a", isDirect: false };
    const plugin = mocks.factories[0]?.({
      channel: sharedScope,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const tools = await getTools(plugin!);

    expect(mocks.yesimbot.registerStorage).toHaveBeenCalledWith("workspace");
    expect(mocks.yesimbot.ensureStorage).toHaveBeenCalledWith(sharedScope, "workspace");
    expect(
      (workspacePlugin as never).workspaces.get("a5vnf2ijd75c2ibyo2s5czdir4").config.root,
    ).toBe("/data/yesimbot/channels/a5vnf2ijd75c2ibyo2s5czdir4/workspace");
    expect(tools.map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);

    await mocks.disposeHandlers[0]?.();
    expect(disposeStorage).toHaveBeenCalledOnce();
  });

  it("stop disposes registration and clears process cache without deleting data", async () => {
    const mocks = createMockCtx(baseDir);
    const disposeStorage = vi.fn();
    mocks.yesimbot.registerStorage.mockReturnValue(disposeStorage);
    const workspacePlugin = new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const scope = { platform: "onebot", selfId: "bot", channelId: "a", isDirect: false };
    const plugin = mocks.factories[0]?.({
      channel: scope,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    await getTools(plugin!);

    const key = mocks.yesimbot.channelKey(scope);
    const workspaces = (workspacePlugin as never).workspaces as Map<string, unknown>;
    expect(workspaces.has(key)).toBe(true);
    const workspaceDir = join(baseDir, "channels", key, "workspace");

    // stop: dispose storage, clear cache
    await mocks.disposeHandlers[0]?.();
    expect(disposeStorage).toHaveBeenCalledOnce();
    expect(workspaces.size).toBe(0);

    // directory is still on disk (data preserved)
    await expect(access(workspaceDir, constants.F_OK)).resolves.toBeUndefined();
  });

  it("restart at same unified root sees existing Workspace data", async () => {
    const scope = { platform: "onebot", selfId: "bot", channelId: "a", isDirect: false };

    // first plugin instance
    const firstMocks = createMockCtx(baseDir);
    const firstPlugin_ = new WorkspacePlugin(firstMocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await firstMocks.readyHandlers[0]?.();
    const firstFactoryPlugin = firstMocks.factories[0]?.({ channel: scope } as never);
    await getTools(firstFactoryPlugin!);
    const firstKey = firstMocks.yesimbot.channelKey(scope);
    const firstWorkspaces = (firstPlugin_ as never).workspaces as Map<
      string,
      { config: { root: string } }
    >;
    const firstRoot = firstWorkspaces.get(firstKey)!.config.root;

    // stop first instance — clears cache but leaves disk data
    await firstMocks.disposeHandlers[0]?.();

    // second plugin instance, same baseDir
    const secondMocks = createMockCtx(baseDir);
    const secondPlugin_ = new WorkspacePlugin(secondMocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await secondMocks.readyHandlers[0]?.();
    const secondFactoryPlugin = secondMocks.factories[0]?.({ channel: scope } as never);
    await getTools(secondFactoryPlugin!);
    const secondKey = secondMocks.yesimbot.channelKey(scope);
    const secondWorkspaces = (secondPlugin_ as never).workspaces as Map<
      string,
      { config: { root: string } }
    >;
    const secondRoot = secondWorkspaces.get(secondKey)!.config.root;

    // same root resolved; second instance did not crash on existing directory
    expect(secondKey).toBe(firstKey);
    expect(secondRoot).toBe(firstRoot);
  });

  it("reuses shared scopes and isolates direct scopes by Core key", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]?.();
    const factory = mocks.factories[0]!;
    const oldSharedScope = { platform: "onebot", selfId: "old", channelId: "a", isDirect: false };
    const newSharedScope = { platform: "onebot", selfId: "new", channelId: "a", isDirect: false };
    const oldDirectScope = { platform: "onebot", selfId: "old", channelId: "a", isDirect: true };
    const newDirectScope = { platform: "onebot", selfId: "new", channelId: "a", isDirect: true };
    mocks.yesimbot.channelKey.mockImplementation((scope) =>
      scope.isDirect ? `direct:${scope.selfId}` : "shared:a",
    );

    const oldSharedPlugin = factory({
      channel: oldSharedScope,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const newSharedPlugin = factory({
      channel: newSharedScope,
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const oldDirectPlugin = factory({
      channel: oldDirectScope,
    } as never);
    const newDirectPlugin = factory({
      channel: newDirectScope,
    } as never);

    await getTools(oldSharedPlugin);
    await getTools(newSharedPlugin);
    await getTools(oldDirectPlugin);
    await getTools(newDirectPlugin);

    expect(mocks.yesimbot.ensureStorage).toHaveBeenCalledTimes(3);
    expect(mocks.yesimbot.ensureStorage).toHaveBeenCalledWith(oldSharedScope, "workspace");
    expect(mocks.yesimbot.ensureStorage).toHaveBeenCalledWith(oldDirectScope, "workspace");
    expect(mocks.yesimbot.ensureStorage).toHaveBeenCalledWith(newDirectScope, "workspace");
  });

  it("extends prompt with sandbox and mount policy", async () => {
    await mkdir(join(baseDir, "shared"), { recursive: true });
    await mkdir(join(baseDir, "knowledge"), { recursive: true });
    await mkdir(join(baseDir, "repo"), { recursive: true });

    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
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
      cwd: "/home/workspace",
      persistPaths: { "/shared": "created/shared" },
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await expect(mocks.readyHandlers[0]?.()).resolves.toBeUndefined();
    await expect(access(join(baseDir, "created/shared"), constants.F_OK)).resolves.toBeUndefined();
  });
});
