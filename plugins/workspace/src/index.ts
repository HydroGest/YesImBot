import { readFile, mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type { ChannelResources, ChannelScope, ResourceReader } from "koishi-plugin-yesimbot";

import { createBashToolSet } from "./bash-tool";
import { normalizeMounts, type NormalizedMountSpec } from "./mounts";
import { formatWorkspacePrompt } from "./prompt";
import { formatSkillsForPrompt, loadSkills, type Skill } from "./skills";
import type { MountSpec, SandboxBashConfig, WorkspacePluginConfig } from "./types";
import { type SandboxWorkspaceConfig, Workspace } from "./workspace";

const SKILL_SCHEME_PROMPT = "读取已注册技能文件：skill://<skill-name>/<relative-path>。执行技能脚本请使用 /skills/<skill-name>/... 虚拟路径。";
const WORKSPACE_SCHEME_PROMPT =
  'workspace:///relative/path 是频道工作区文件的对外引用，与沙箱内的 /home/workspace/relative/path 是同一个文件。沙箱内部操作用 readFile/bash 的 /home/workspace/... 路径，bash 不接受 workspace:// 形式。把工作区文件发出去时可用作 img/file 的 src，例如 <img src="workspace:///out/chart.png"/>。';

export default class WorkspacePlugin {
  public static name = "yesimbot-workspace";
  public static usage = "工作区插件，提供虚拟文件系统和 Bash 沙箱环境";
  public static inject = ["yesimbot"];

  public static Config: Schema<WorkspacePluginConfig> = Schema.object({
    bash: Schema.object({
      cwd: Schema.string().default("/home/workspace").description("虚拟文件系统默认目录"),
      mounts: Schema.array(
        Schema.object({
          source: Schema.string().min(1).required(),
          target: Schema.string().min(1).required(),
          mode: Schema.union([Schema.const("rw"), Schema.const("ro"), Schema.const("overlay")]).required(),
        }),
      )
        .role("table")
        .default([])
        .description("Sandbox 挂载声明"),
      timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
      enableNetwork: Schema.boolean().default(false).description("启用网络访问（仅拒绝私有地址，不设 URL 白名单）"),
      /**
       * Python/JavaScript 执行依赖 just-bash 的 wasm worker。Workspace 通过动态
       * import 固定加载 just-bash 的 ESM bundle，避免 CJS bundle 中 esbuild 把
       * import.meta 替换成 {} 导致 worker 路径解析失败（"Invalid URL"）。
       * */
      enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
      enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
    }).description("Bash 沙箱配置"),
    skillPaths: Schema.array(Schema.path({ filters: ["directory", "file"], allowCreate: true })),
  });

  public readonly ctx: Context;
  public readonly config: WorkspacePluginConfig;
  public readonly logger: Logger;

  private workspaces = new Map<string, Workspace>();
  private skills: Skill[] = [];
  private skillCatalog: readonly Skill[] = [];
  private sandbox?: SandboxBashConfig;
  private normalizedMounts?: readonly NormalizedMountSpec[];
  private disposeAgentPlugin?: () => void;
  private disposeReaders: Array<() => void> = [];

  constructor(ctx: Context, config: WorkspacePluginConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("workspace");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.logger.info("Starting workspace plugin...");

    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.disposeReaders.splice(0)) dispose();

    const sandbox = this.getSandboxConfig();
    const skillPaths = (this.config.skillPaths ?? []).map((path) => resolve(this.ctx.baseDir, path));
    const loadResult = await loadSkills({ skillPaths, cwd: this.ctx.baseDir });
    for (const diagnostic of loadResult.diagnostics) {
      this.logger.warn(`技能加载诊断: ${diagnostic.message} (${diagnostic.path ?? "unknown"})`);
    }
    this.skills.splice(0, this.skills.length, ...loadResult.skills);
    const skillCatalog = this.skills.map((skill) => ({ ...skill }));
    for (const skill of skillCatalog) {
      this.logger.info(`加载技能: ${skill.name} (${skill.filePath})`);
    }

    const userMounts: MountSpec[] = [...(sandbox?.mounts ?? [])];
    assertNoSkillMountOverlap(userMounts);
    const skillMounts: MountSpec[] = skillCatalog.map((skill) => ({ source: skill.baseDir, target: `/skills/${skill.name}`, mode: "ro" as const }));
    const requestedMounts = [...userMounts, ...skillMounts];
    this.normalizedMounts = await normalizeMounts(requestedMounts, this.ctx.baseDir);
    this.logger.info(`Sandbox mounts: ${JSON.stringify(this.normalizedMounts, null, 2)}`);

    this.skillCatalog = skillCatalog;
    this.sandbox = sandbox;
    const owner = this;
    if (skillCatalog.length > 0) {
      const skillReader: ResourceReader = {
        scheme: "skill",
        prompt: SKILL_SCHEME_PROMPT,
        setup(resources, uri, options) {
          return owner.openSkillFromCatalog(skillCatalog, resources, uri, options);
        },
      };
      this.disposeReaders.push(this.ctx.yesimbot.resource.use(skillReader));
    }
    const workspaceReader: ResourceReader = {
      scheme: "workspace",
      prompt: WORKSPACE_SCHEME_PROMPT,
      setup(resources, uri, options) {
        return owner.openWorkspace(resources, uri, options);
      },
    };
    this.disposeReaders.push(this.ctx.yesimbot.resource.use(workspaceReader));
    this.disposeAgentPlugin = this.ctx.yesimbot.agent.use(this);

    this.logger.success("Workspace plugin started");
  }

  public async setup(scope: ChannelScope): Promise<AgentPlugin | null> {
    const sandbox = this.sandbox;
    if (!sandbox) return null;
    const resources = await this.ctx.yesimbot.resource.get(scope);
    const runtimeSkills = this.skillCatalog.map((skill) => ({ ...skill }));
    const runtimeMounts = this.normalizedMounts;
    return {
      name: "workspace",
      tools: async () => createBashToolSet(await this.getOrCreateWorkspace(scope, resources, sandbox, runtimeMounts)),
      appendSystemPrompt: async () => {
        const workspace = await this.getOrCreateWorkspace(scope, resources, sandbox, runtimeMounts);
        return [formatWorkspacePrompt(workspace), formatSkillsForPrompt(runtimeSkills)].filter(Boolean);
      },
    } satisfies AgentPlugin;
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.disposeReaders.splice(0)) dispose();
    this.workspaces.clear();
    this.skillCatalog = [];
    this.sandbox = undefined;
    this.logger.info("Workspace plugin stopped");
  }

  private async getOrCreateWorkspace(
    channel: ChannelScope,
    resources: ChannelResources,
    sandbox: SandboxBashConfig,
    mounts: readonly NormalizedMountSpec[] | undefined,
  ): Promise<Workspace> {
    const key = JSON.stringify(channel.type === "direct" ? [channel.platform, channel.selfId, channel.channelId] : [channel.platform, channel.channelId]);
    const existing = this.workspaces.get(key);
    if (existing) {
      return existing;
    }

    if (!mounts) {
      throw new Error("Workspace plugin has not been started");
    }

    const workspaceRoot = join(resources.path, "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    const workspace = await Workspace.create(this.createWorkspaceConfig(workspaceRoot, sandbox, mounts));
    await workspace.init();
    this.workspaces.set(key, workspace);
    return workspace;
  }

  private createWorkspaceConfig(root: string, sandbox: SandboxBashConfig, mounts: readonly NormalizedMountSpec[]): SandboxWorkspaceConfig {
    const networkConfig = sandbox.enableNetwork ? { dangerouslyAllowFullInternetAccess: true } : undefined;
    return {
      root,
      filesystem: { ...workspaceMountMaps(mounts) },
      bash: {
        cwd: sandbox.cwd ?? "/home/workspace",
        timeoutMs: sandbox.timeoutMs,
        network: networkConfig,
        python: sandbox.enablePython,
        javascript: sandbox.enableJavascript,
      },
      git: { network: networkConfig },
    };
  }

  private getSandboxConfig(): SandboxBashConfig {
    const bash = this.config.bash;
    return {
      mounts: (bash?.mounts ?? []).map((mount) => ({ ...mount })),
      cwd: bash?.cwd,
      timeoutMs: bash?.timeoutMs,
      enableNetwork: bash?.enableNetwork,
      enablePython: bash?.enablePython,
      enableJavascript: bash?.enableJavascript,
    };
  }

  private async openSkillFromCatalog(
    skills: readonly Skill[],
    _resources: ChannelResources,
    uri: URL,
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }> {
    const parsed = parseSkillUri(uri.href);
    if (!parsed) throw new Error("Invalid skill URI");
    const skill = skills.find((candidate) => candidate.name === parsed.name);
    if (!skill) throw new Error("Skill not found");
    const resolved = resolve(skill.baseDir, parsed.relativePath);
    if (!isPathContained(skill.baseDir, resolved)) {
      throw new Error("Skill path escapes its root");
    }
    const realRoot = await realpath(skill.baseDir);
    const realFile = await realpath(resolved);
    if (!isPathContained(realRoot, realFile) || realFile === realRoot) {
      throw new Error("Skill path escapes its root");
    }
    const bytes = await readBoundedFile(realFile, options);
    return { bytes, filename: basename(realFile) };
  }

  private async openWorkspace(
    resources: ChannelResources,
    uri: URL,
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }> {
    const relativePath = parseWorkspaceUri(uri.href);
    if (!relativePath) throw new Error("Invalid workspace URI");
    const root = join(resources.path, "workspace");
    const resolved = resolve(root, relativePath);
    if (!isPathContained(root, resolved)) {
      throw new Error("Workspace path escapes its root");
    }
    const realRoot = await realpath(root);
    const realFile = await realpath(resolved);
    if (!isPathContained(realRoot, realFile) || realFile === realRoot) {
      throw new Error("Workspace path escapes its root");
    }
    const bytes = await readBoundedFile(realFile, options);
    return { bytes, filename: basename(realFile) };
  }
}

async function readBoundedFile(filePath: string, options: { signal: AbortSignal; maxBytes: number }): Promise<Uint8Array> {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error("Resource path is not a file");
  if (metadata.size > options.maxBytes) throw new Error("Resource file exceeds read limit");
  const bytes = new Uint8Array(await readFile(filePath, { signal: options.signal }));
  if (bytes.byteLength > options.maxBytes) throw new Error("Resource file exceeds read limit");
  return bytes;
}

function assertNoSkillMountOverlap(mounts: readonly MountSpec[]): void {
  for (const mount of mounts) {
    if (mount.target === "/skills" || mount.target.startsWith("/skills/")) {
      throw new Error(`${mount.target} is a reserved Skill mount point`);
    }
  }
}

function workspaceMountMaps(mounts: readonly NormalizedMountSpec[]): {
  persistPaths: Record<string, string>;
  readOnlyPaths: Record<string, string>;
  overlayPaths: Record<string, string>;
} {
  const result = { persistPaths: {} as Record<string, string>, readOnlyPaths: {} as Record<string, string>, overlayPaths: {} as Record<string, string> };
  for (const mount of mounts) {
    if (mount.mode === "rw") result.persistPaths[mount.target] = mount.source;
    if (mount.mode === "ro") result.readOnlyPaths[mount.target] = mount.source;
    if (mount.mode === "overlay") result.overlayPaths[mount.target] = mount.source;
  }
  return result;
}

function parseSkillUri(uri: string): { name: string; relativePath: string } | undefined {
  const match = /^skill:\/\/([^/?#]+)\/([^?#]+)$/.exec(uri);
  if (!match) return undefined;
  const name = match[1]!;
  const relativePath = match[2]!;
  if (!/^[a-z0-9-]+$/.test(name) || !isSafeRelativePath(relativePath)) return undefined;
  return { name, relativePath };
}

function parseWorkspaceUri(uri: string): string | undefined {
  const match = /^workspace:\/\/\/([^?#]+)$/.exec(uri);
  if (!match || !isSafeRelativePath(match[1]!)) return undefined;
  return match[1]!;
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.includes("%") || path.startsWith("/") || path.endsWith("/")) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isPathContained(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
