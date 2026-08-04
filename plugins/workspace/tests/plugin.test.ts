import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import type { ChannelScope } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => ({
  Context: class {},
  Logger: class {},
  Schema: {
    array: (value: unknown) => value,
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
import { Workspace } from "../src/workspace";

type WorkspaceFactory = (context: { readonly scope: ChannelScope }) => AgentPlugin;

type ResourceOpener = (
  scope: ChannelScope,
  uri: string,
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }>;

type ResourceRegistration = { prompt: string; open: ResourceOpener };

function workspaceCache(plugin: WorkspacePlugin): ReadonlyMap<string, Workspace> {
  const value: unknown = Reflect.get(plugin, "workspaces");
  if (!(value instanceof Map)) throw new Error("Workspace cache is unavailable");
  return value as ReadonlyMap<string, Workspace>;
}

function workspaceRoot(plugin: WorkspacePlugin, key: string): string {
  const workspace = workspaceCache(plugin).get(key);
  if (!workspace) throw new Error(`Workspace ${key} is unavailable`);
  return workspace.config.root;
}

async function tools(plugin: AgentPlugin): Promise<readonly AgentTool[]> {
  return typeof plugin.tools === "function" ? ((await plugin.tools({} as never)) ?? []) : (plugin.tools ?? []);
}

function createContext(baseDir: string) {
  const ready: Array<() => Promise<void> | void> = [];
  const dispose: Array<() => Promise<void> | void> = [];
  const factories: WorkspaceFactory[] = [];
  const schemes = new Map<string, ResourceRegistration>();
  const getStoragePath = vi.fn(async (scope: ChannelScope) => {
    const directory =
      scope.type === "direct"
        ? `direct-${scope.platform}-${scope.channelId}-${scope.selfId}`
        : `shared-${scope.platform}-${scope.channelId}`;
    const root = join(baseDir, "channels", directory);
    await mkdir(root, { recursive: true });
    return root;
  });
  return {
    ready,
    dispose,
    factories,
    getStoragePath,
    ctx: {
      baseDir,
      logger: () => ({
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      on: vi.fn((event: string, callback: () => Promise<void> | void) => {
        if (event === "ready") ready.push(callback);
        if (event === "dispose") dispose.push(callback);
      }),
      yesimbot: {
        getStoragePath,
        registerChannelPlugin: vi.fn((factory: WorkspaceFactory) => {
          factories.push(factory);
          return vi.fn();
        }),
        registerResourceScheme: vi.fn((scheme: string, prompt: string, open: ResourceOpener) => {
          schemes.set(scheme, { prompt, open });
          return vi.fn(() => schemes.delete(scheme));
        }),
      },
    },
    schemes,
  };
}

describe("WorkspacePlugin", () => {
  let baseDir = "";

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it("places its workspace below the Core channel root", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const ready: Array<() => Promise<void> | void> = [];
    const factories: WorkspaceFactory[] = [];
    const getStoragePath = vi.fn(async () => {
      const root = join(baseDir, "channels", "shared-onebot-room");
      await mkdir(root, { recursive: true });
      return root;
    });
    const ctx = {
      baseDir,
      logger: () => ({
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      on: vi.fn((event: string, callback: () => Promise<void> | void) => {
        if (event === "ready") ready.push(callback);
      }),
      yesimbot: {
        getStoragePath,
        registerChannelPlugin: vi.fn((factory: WorkspaceFactory) => {
          factories.push(factory);
          return vi.fn();
        }),
        registerResourceScheme: vi.fn(() => vi.fn()),
      },
    };
    const plugin = new WorkspacePlugin(ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await ready[0]?.();
    const scope = {
      platform: "onebot",
      selfId: "bot",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const agentPlugin = factories[0]?.({ scope });
    expect(agentPlugin).toBeDefined();
    expect((await tools(agentPlugin!)).map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
    expect(getStoragePath).toHaveBeenCalledWith(scope);
    expect(workspaceRoot(plugin, JSON.stringify(["onebot", "room"]))).toBe(
      join(baseDir, "channels", "shared-onebot-room", "workspace"),
    );
  });
  it("does not register a Skill scheme without a valid catalog", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-no-skills-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      skillPaths: [join(baseDir, "missing")],
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.ready[0]?.();
    expect([...mocks.schemes.keys()]).toEqual(["workspace"]);
  });

  it("clears process cache on stop without deleting workspace data", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();
    const scope = {
      platform: "onebot",
      selfId: "bot",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    await tools(mocks.factories[0]!({ scope }));
    const root = join(baseDir, "channels", "shared-onebot-room", "workspace");

    await mocks.dispose[0]?.();

    expect(workspaceCache(plugin).size).toBe(0);
    await expect(access(root, constants.F_OK)).resolves.toBeUndefined();
  });

  it("reopens the same root after a plugin restart", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const scope = {
      platform: "onebot",
      selfId: "bot",
      channelId: "room",
      type: "shared",
    } satisfies ChannelScope;
    const first = createContext(baseDir);
    const firstPlugin = new WorkspacePlugin(first.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await first.ready[0]?.();
    await tools(first.factories[0]!({ scope }));
    const firstRoot = workspaceRoot(firstPlugin, JSON.stringify(["onebot", "room"]));
    await first.dispose[0]?.();

    const second = createContext(baseDir);
    const secondPlugin = new WorkspacePlugin(second.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await second.ready[0]?.();
    await tools(second.factories[0]!({ scope }));
    expect(workspaceRoot(secondPlugin, JSON.stringify(["onebot", "room"]))).toBe(firstRoot);
  });

  it("reuses shared scopes and isolates direct scopes", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();
    const factory = mocks.factories[0]!;
    await tools(factory({ scope: { platform: "onebot", selfId: "old", channelId: "room", type: "shared" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "new", channelId: "room", type: "shared" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "old", channelId: "room", type: "direct" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "new", channelId: "room", type: "direct" } }));

    expect(workspaceCache(plugin).size).toBe(3);
    expect(mocks.getStoragePath).toHaveBeenCalledTimes(3);
  });

  it("includes sandbox and mount policy in its prompt", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    await Promise.all([mkdir(join(baseDir, "knowledge")), mkdir(join(baseDir, "repo"))]);
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      persistPaths: { "/shared": "shared" },
      readOnlyPaths: { "/knowledge": "knowledge" },
      overlayPaths: { "/repo": "repo" },
      timeoutMs: 5000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();
    const prompt = await mocks.factories[0]!({
      scope: { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" },
    }).appendSystemPrompt?.({} as never);
    expect(String(prompt)).toContain("Network access: disabled");
    expect(String(prompt)).toContain("Command timeout: 5000 ms");
    expect(String(prompt)).toContain("/shared");
    expect(String(prompt)).toContain("/knowledge");
    expect(String(prompt)).toContain("/repo");
  });

  it.each(["readOnlyPaths", "overlayPaths"] as const)("fails fast for a missing %s host path", async (field) => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      [field]: { "/missing": "missing" },
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await expect(mocks.ready[0]?.()).rejects.toThrow();
  });

  it("creates persist mount host paths", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      persistPaths: { "/shared": "created/shared" },
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await expect(mocks.ready[0]?.()).resolves.toBeUndefined();
    await expect(access(join(baseDir, "created", "shared"), constants.F_OK)).resolves.toBeUndefined();
  });
  it("registers canonical Workspace and Skill URI readers and read-only Skill mounts", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const skillRoot = join(baseDir, "skills", "csv");
    await mkdir(join(skillRoot, "scripts"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: csv\ndescription: CSV\n---\n# CSV");
    await writeFile(join(skillRoot, "scripts", "analyze.sh"), "echo csv\n");

    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      skillPaths: [join(baseDir, "skills")],
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();

    expect([...mocks.schemes.keys()].sort()).toEqual(["skill", "workspace"]);
    const scope = { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" } satisfies ChannelScope;
    const workspaceRoot = join(baseDir, "channels", "shared-onebot-room", "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "report.txt"), "live report");

    const workspaceResult = await mocks.schemes.get("workspace")!.open(scope, "workspace:///report.txt", {
      signal: AbortSignal.timeout(1000),
      maxBytes: 1024,
    });
    expect(new TextDecoder().decode(workspaceResult.bytes)).toBe("live report");

    const skillResult = await mocks.schemes.get("skill")!.open(scope, "skill://csv/scripts/analyze.sh", {
      signal: AbortSignal.timeout(1000),
      maxBytes: 1024,
    });
    expect(new TextDecoder().decode(skillResult.bytes)).toBe("echo csv\n");
    await expect(
      mocks.schemes.get("workspace")!.open(scope, "workspace://host/report.txt", {
        signal: AbortSignal.timeout(1000),
        maxBytes: 1024,
      }),
    ).rejects.toThrow();

    const agentPlugin = mocks.factories[0]!({ scope });
    const agentTools = await tools(agentPlugin);
    const loaderName = ["load", "skill"].join("_");
    expect(agentTools.map((tool) => tool.name)).not.toContain(loaderName);
    const readFile = agentTools.find((tool) => tool.name === "readFile");
    const writeFileTool = agentTools.find((tool) => tool.name === "writeFile");
    await expect(readFile!.execute!({ path: "/skills/csv/scripts/analyze.sh" }, {} as never)).resolves.toEqual({
      content: "echo csv\n",
    });
    await expect(
      writeFileTool!.execute!({ path: "/skills/csv/scripts/analyze.sh", content: "changed" }, {} as never),
    ).rejects.toThrow();
  });

  it("keeps a Skill opener catalog snapshot after Workspace stop", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-snapshot-"));
    const skillRoot = join(baseDir, "skills", "csv");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: csv\ndescription: CSV\n---\n# CSV");
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      skillPaths: [join(baseDir, "skills")],
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();
    const registration = mocks.schemes.get("skill");
    if (!registration) throw new Error("Skill registration is unavailable");
    await mocks.dispose[0]?.();

    await expect(
      registration.open(
        { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" },
        "skill://csv/SKILL.md",
        { signal: AbortSignal.timeout(1000), maxBytes: 1024 },
      ),
    ).resolves.toMatchObject({ filename: "SKILL.md" });
  });

  it("rejects oversized Workspace and Skill files before reading their contents", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-bounds-"));
    const skillRoot = join(baseDir, "skills", "csv");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "---\nname: csv\ndescription: CSV\n---\n" + "x".repeat(2048));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      skillPaths: [join(baseDir, "skills")],
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await mocks.ready[0]?.();
    const scope = { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" } satisfies ChannelScope;
    await expect(
      mocks.schemes.get("skill")!.open(scope, "skill://csv/SKILL.md", {
        signal: AbortSignal.timeout(1000),
        maxBytes: 1,
      }),
    ).rejects.toThrow(/exceeds read limit/);
  });

  it("rejects user mounts that overlap the reserved Skill mount root", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      cwd: "/home/workspace",
      readOnlyPaths: { "/skills": baseDir },
      timeoutMs: 1000,
      enableNetwork: false,
    });
    await expect(mocks.ready[0]?.()).rejects.toThrow(/reserved/);
  });
});
