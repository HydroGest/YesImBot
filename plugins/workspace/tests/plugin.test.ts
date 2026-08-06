import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentPlugin, AgentTool } from "@yesimbot/agent-runtime";
import type { ChannelScope } from "koishi-plugin-yesimbot";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", async () => {
  const { Schema } = await import("@koishijs/core");
  return { Context: class {}, Logger: class {}, Schema };
});

import WorkspacePlugin from "../src";
import type { MountSpec, SandboxBashConfig, WorkspacePluginConfig } from "../src/types";
import { Workspace } from "../src/workspace";

type WorkspaceFactory = (context: {
  readonly scope: ChannelScope;
  readonly bot?: unknown;
}) => AgentPlugin | Promise<AgentPlugin | null>;

type ResourceOpener = (
  scope: ChannelScope,
  uri: string,
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }>;

type CommandRecord = {
  name: string;
  options?: Record<string, unknown>;
  action?: (...args: unknown[]) => unknown;
  disposed: boolean;
};

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

async function tools(plugin: AgentPlugin | Promise<AgentPlugin | null>): Promise<readonly AgentTool[]> {
  const resolved = await plugin;
  if (!resolved) return [];
  return typeof resolved.tools === "function" ? ((await resolved.tools({} as never)) ?? []) : (resolved.tools ?? []);
}

function hostIdentity(): { uid: number; gid: number } {
  return { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
}

function hostRuntimeAvailable(): boolean {
  if (process.platform !== "linux") return true;
  const identity = hostIdentity();
  const result = spawnSync(
    "/usr/bin/setpriv",
    ["--clear-groups", "--reuid", String(identity.uid), "--regid", String(identity.gid), "--", "/bin/true"],
    { stdio: "ignore" },
  );
  return result.status === 0 && result.error === undefined;
}

function sandboxConfig(
  overrides: Partial<Omit<SandboxBashConfig, "mode" | "mounts">> & { mounts?: readonly MountSpec[] } = {},
  skillPaths?: string[],
): WorkspacePluginConfig {
  return {
    bash: {
      mode: "sandbox",
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
      mounts: [],
      ...overrides,
    },
    ...(skillPaths ? { skillPaths } : {}),
  };
}

function createContext(baseDir: string) {
  const ready: Array<() => Promise<void> | void> = [];
  const dispose: Array<() => Promise<void> | void> = [];
  const factories: WorkspaceFactory[] = [];
  const schemes = new Map<string, ResourceRegistration>();
  const commands: CommandRecord[] = [];
  const command = vi.fn((definition: string, _description?: string, options?: Record<string, unknown>) => {
    const record: CommandRecord = { name: definition.split(/\s+/, 1)[0] ?? definition, options, disposed: false };
    const api = {
      action: (handler: (...args: unknown[]) => unknown) => {
        record.action = handler;
        return api;
      },
      dispose: () => {
        record.disposed = true;
      },
    };
    commands.push(record);
    return api;
  });
  const bot = { sendMessage: vi.fn(async () => []) };
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
    commands,
    command,
    bot,
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
      command,
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

  it("validates the Sandbox default and keeps mode-specific fields separated", () => {
    const defaults = WorkspacePlugin.Config({});
    expect(defaults.bash?.mode).toBe("sandbox");
    expect(defaults.bash?.mounts).toEqual([]);

    const sandbox = WorkspacePlugin.Config({
      bash: {
        mode: "sandbox",
        mounts: [],
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        identity: { uid: 1000, gid: 1000 },
      } as never,
    });
    expect(sandbox.bash).not.toHaveProperty("allowedChannels");
    expect(sandbox.bash).not.toHaveProperty("identity");

    expect(() =>
      WorkspacePlugin.Config({ bash: { mode: "host", allowedChannels: [], hostRoots: [] } as never }),
    ).toThrow();
  });

  it("requires the complete Host branch", () => {
    const host = WorkspacePlugin.Config({
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room", type: "shared", selfId: "*" }],
        hostRoots: [{ path: "/srv/workspace", mode: "ro" }],
        identity: { uid: 1000, gid: 1000 },
        mounts: [{ source: ".", target: "/ignored", mode: "rw" }],
      } as never,
    });

    expect(host.bash).toMatchObject({ mode: "host", allowedChannels: [{ platform: "onebot" }] });
    expect(host.bash).not.toHaveProperty("mounts");
  });

  it("defaults an omitted bash mode to Sandbox and keeps Host fields out", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-schema-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mounts: [],
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        identity: { uid: 1000, gid: 1000 },
      } as never,
    });

    await mocks.ready[0]?.();
    const agentPlugin = mocks.factories[0]!({
      scope: { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" },
    });
    expect((await tools(agentPlugin)).map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
  });

  it("does not initialize a virtual Workspace for explicit Host mode", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-config-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });

    await mocks.ready[0]?.();
    const agentPlugin = mocks.factories[0]!({
      scope: { platform: "onebot", selfId: "bot", channelId: "room", type: "shared" },
    });
    expect((await tools(agentPlugin)).map((tool) => tool.name).sort()).toEqual(
      hostRuntimeAvailable() ? ["bash", "readFile", "writeFile"] : [],
    );
    expect(workspaceCache(plugin).size).toBe(0);
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
    const plugin = new WorkspacePlugin(ctx as never, sandboxConfig());

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
    new WorkspacePlugin(mocks.ctx as never, sandboxConfig({}, [join(baseDir, "missing")]));

    await mocks.ready[0]?.();
    expect([...mocks.schemes.keys()]).toEqual(["workspace"]);
  });

  it("clears process cache on stop without deleting workspace data", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, sandboxConfig());
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
    const firstPlugin = new WorkspacePlugin(first.ctx as never, sandboxConfig());
    await first.ready[0]?.();
    await tools(first.factories[0]!({ scope }));
    const firstRoot = workspaceRoot(firstPlugin, JSON.stringify(["onebot", "room"]));
    await first.dispose[0]?.();

    const second = createContext(baseDir);
    const secondPlugin = new WorkspacePlugin(second.ctx as never, sandboxConfig());
    await second.ready[0]?.();
    await tools(second.factories[0]!({ scope }));
    expect(workspaceRoot(secondPlugin, JSON.stringify(["onebot", "room"]))).toBe(firstRoot);
  });

  it("reuses shared scopes and isolates direct scopes", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, sandboxConfig());
    await mocks.ready[0]?.();
    const factory = mocks.factories[0]!;
    await tools(factory({ scope: { platform: "onebot", selfId: "old", channelId: "room", type: "shared" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "new", channelId: "room", type: "shared" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "old", channelId: "room", type: "direct" } }));
    await tools(factory({ scope: { platform: "onebot", selfId: "new", channelId: "room", type: "direct" } }));

    expect(workspaceCache(plugin).size).toBe(3);
    expect(mocks.getStoragePath).toHaveBeenCalledTimes(3);
  });

  it.each(["ro", "overlay"] as const)("fails fast for a missing %s host path", async (mode) => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(
      mocks.ctx as never,
      sandboxConfig({ mounts: [{ source: "missing", target: "/missing", mode }] }),
    );
    await expect(mocks.ready[0]?.()).rejects.toThrow();
  });

  it("creates persist mount host paths", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(
      mocks.ctx as never,
      sandboxConfig({ mounts: [{ source: "created/shared", target: "/shared", mode: "rw" }] }),
    );
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
    new WorkspacePlugin(mocks.ctx as never, sandboxConfig({}, [join(baseDir, "skills")]));
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
    new WorkspacePlugin(mocks.ctx as never, sandboxConfig({}, [join(baseDir, "skills")]));
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
    new WorkspacePlugin(mocks.ctx as never, sandboxConfig({}, [join(baseDir, "skills")]));
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
    new WorkspacePlugin(
      mocks.ctx as never,
      sandboxConfig({ mounts: [{ source: ".", target: "/skills", mode: "ro" }] }),
    );
    await expect(mocks.ready[0]?.()).rejects.toThrow(/reserved/);
  });
  it("registers Host approval commands and releases the unchanged risky call after authority-5 approval", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-approval-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();

    expect(mocks.commands.map((record) => record.name)).toEqual([
      "yesimbot.workspace.approvals",
      "yesimbot.workspace.approve",
      "yesimbot.workspace.reject",
    ]);
    expect(mocks.commands.every((record) => record.options?.authority === 5)).toBe(true);

    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]?.({ scope, bot: mocks.bot });
    if (!hostRuntimeAvailable()) {
      expect(await tools(agent!)).toEqual([]);
      await expect(
        agent!.beforeToolCall?.({ toolCallId: "blocked", toolName: "bash", args: { command: "pwd" } }, {} as never),
      ).resolves.toEqual({ type: "block", reason: "host-runtime-unavailable" });
      return;
    }
    expect(agent?.tools ? await tools(agent) : []).toHaveLength(3);
    expect((await tools(agent!)).map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
    const prompt = await agent?.appendSystemPrompt?.({} as never);
    expect(prompt?.[0]).toContain("审批");

    const args = { command: "rm secret.txt" };
    const controller = new AbortController();
    const call = { toolCallId: "call-1", toolName: "bash", args };
    const pending = agent?.beforeToolCall?.(call, { signal: controller.signal } as never);
    const listAction = mocks.commands[0]?.action;
    await vi.waitFor(async () => {
      const listing = String(await listAction?.({ session: { user: { authority: 5 } } }));
      expect(listing).not.toContain("没有待审批");
    });
    const listing = String(await listAction?.({ session: { user: { authority: 5 } } }));
    const requestId = listing.split(/\s+/, 1)[0];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.bot.sendMessage).toHaveBeenCalledOnce();

    const approveAction = mocks.commands[1]?.action;
    expect(await approveAction?.({ session: { user: { authority: 4 } } }, requestId)).toBe("权限不足");
    expect(await approveAction?.({ session: { user: { authority: 5, id: "admin" } } }, requestId)).toBe("已批准");
    await expect(pending).resolves.toEqual({ type: "allow" });
    expect(args).toEqual({ command: "rm secret.txt" });
  });

  it("assembles real Host tools for an allowed channel without a virtual Workspace", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-tools-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    const agentTools = await tools(agent!);
    if (!hostRuntimeAvailable()) {
      expect(agentTools).toEqual([]);
      expect(workspaceCache(plugin).size).toBe(0);
      return;
    }
    expect(agentTools.map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
    expect(workspaceCache(plugin).size).toBe(0);

    const bash = agentTools.find((tool) => tool.name === "bash")!;
    const write = agentTools.find((tool) => tool.name === "writeFile")!;
    const read = agentTools.find((tool) => tool.name === "readFile")!;
    expect(bash.description).toContain("approved Host environment");
    await expect(write.execute!({ path: "note.txt", content: "host" }, {} as never)).resolves.toEqual({
      success: true,
    });
    await expect(read.execute!({ path: "note.txt" }, {} as never)).resolves.toEqual({ content: "host" });
    await mocks.dispose[0]?.();
  });

  it("fails closed before Host resources for an unlisted channel", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-deny-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "allowed" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "blocked" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    expect(await tools(agent!)).toEqual([]);
    expect(mocks.getStoragePath).not.toHaveBeenCalled();
    await expect(
      agent!.beforeToolCall?.({ toolCallId: "blocked", toolName: "bash", args: { command: "pwd" } }, {} as never),
    ).resolves.toEqual({ type: "block", reason: "host-channel-not-allowed" });
    await expect(
      agent!.beforeToolCall?.({ toolCallId: "core", toolName: "sendMessage", args: {} }, {} as never),
    ).resolves.toEqual({ type: "allow" });
  });

  it("fails closed when the Host approval broker is unavailable", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-no-broker-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();
    Reflect.set(plugin, "hostApprovalBroker", undefined);
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    expect(await tools(agent!)).toEqual([]);
    await expect(
      agent!.beforeToolCall?.({ toolCallId: "blocked", toolName: "bash", args: { command: "rm file" } }, {} as never),
    ).resolves.toEqual({ type: "block", reason: "host-approval-unavailable" });
  });

  it.each([
    ["identity", { identity: { uid: Number.NaN, gid: Number.NaN } }],
    ["roots", { hostRoots: [{ path: "missing-root", mode: "rw" as const }] }],
  ])("fails closed when Host %s cannot be established", async (_label, overrides) => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-prereq-"));
    const mocks = createContext(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
        ...overrides,
      } as never,
    });
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    expect(await tools(agent!)).toEqual([]);
    expect(mocks.getStoragePath).not.toHaveBeenCalled();
    await expect(
      agent!.beforeToolCall?.({ toolCallId: "blocked", toolName: "bash", args: { command: "pwd" } }, {} as never),
    ).resolves.toEqual({ type: "block", reason: "host-runtime-unavailable" });
  });

  it("fails closed when the real channel cwd cannot be created", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-cwd-"));
    const mocks = createContext(baseDir);
    mocks.getStoragePath.mockRejectedValue(new Error("storage unavailable"));
    new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    expect(await tools(agent!)).toEqual([]);
    await expect(
      agent!.beforeToolCall?.({ toolCallId: "blocked", toolName: "bash", args: { command: "pwd" } }, {} as never),
    ).resolves.toEqual({ type: "block", reason: "host-runtime-unavailable" });
  });

  it("stops the shared Host runner when the plugin stops", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-stop-"));
    const mocks = createContext(baseDir);
    const plugin = new WorkspacePlugin(mocks.ctx as never, {
      bash: {
        mode: "host",
        allowedChannels: [{ platform: "onebot", channelId: "room" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    });
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = await mocks.factories[0]!({ scope, bot: mocks.bot });
    await tools(agent!);
    const runner = Reflect.get(plugin, "hostRunner") as { stop: () => Promise<void> } | undefined;
    if (!hostRuntimeAvailable()) {
      expect(runner).toBeUndefined();
      await mocks.dispose[0]?.();
      return;
    }
    expect(runner).toBeDefined();
    const stop = vi.spyOn(runner!, "stop");
    await mocks.dispose[0]?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("keeps an existing Host plugin's allowlist snapshot after config mutation", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-host-snapshot-"));
    const mocks = createContext(baseDir);
    const config = {
      bash: {
        mode: "host" as const,
        allowedChannels: [{ platform: "onebot", channelId: "old" }],
        hostRoots: [],
        identity: hostIdentity(),
      },
    };
    new WorkspacePlugin(mocks.ctx as never, config);
    await mocks.ready[0]?.();
    const oldScope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "old" } satisfies ChannelScope;
    const oldAgent = await mocks.factories[0]!({ scope: oldScope, bot: mocks.bot });
    (config.bash.allowedChannels as Array<{ platform: string; channelId: string }>).splice(0, 1, {
      platform: "onebot",
      channelId: "new",
    });
    const oldDecision = await oldAgent!.beforeToolCall?.(
      { toolCallId: "old", toolName: "bash", args: { command: "pwd" } },
      {} as never,
    );
    expect(oldDecision).toEqual(
      hostRuntimeAvailable() ? { type: "allow" } : { type: "block", reason: "host-runtime-unavailable" },
    );
  });

  it("keeps an existing Sandbox runtime's mode settings after config mutation", async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-workspace-sandbox-snapshot-"));
    const mocks = createContext(baseDir);
    const config = {
      bash: {
        mode: "sandbox" as const,
        cwd: "/home/workspace",
        timeoutMs: 1000,
        mounts: [],
      },
    };
    const plugin = new WorkspacePlugin(mocks.ctx as never, config);
    await mocks.ready[0]?.();
    const scope = { type: "shared", platform: "onebot", selfId: "bot", channelId: "room" } satisfies ChannelScope;
    const agent = mocks.factories[0]!({ scope });
    config.bash.cwd = "/changed-after-runtime-creation";
    await tools(agent);
    expect(workspaceCache(plugin).get(JSON.stringify(["onebot", "room"]))?.config.bash.cwd).toBe("/home/workspace");
  });
});
