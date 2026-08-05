import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type { ChannelScope, ResourceSchemeOpenHandler } from "koishi-plugin-yesimbot";

import { createBashToolSet } from "./bash-tool";
import { assertValidMountConfig } from "./mounts";
import { formatWorkspacePrompt } from "./prompt";
import { formatSkillsForPrompt, loadSkills, type Skill } from "./skills";
import type { WorkspaceConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspacePluginConfig {
  cwd: string;
  persistPaths?: Record<string, string>;
  readOnlyPaths?: Record<string, string>;
  overlayPaths?: Record<string, string>;
  timeoutMs?: number;
  enableNetwork?: boolean;
  enablePython?: boolean;
  enableJavascript?: boolean;
  skillPaths?: string[];
}

export default class WorkspacePlugin {
  public static name = "yesimbot-workspace";
  public static usage = "工作区插件，提供虚拟文件系统和 Bash 沙箱环境";
  public static inject = ["yesimbot"];

  public static Config: Schema<WorkspacePluginConfig> = Schema.object({
    cwd: Schema.string().default("/home/workspace").description("虚拟文件系统默认目录"),
    persistPaths: Schema.dict(Schema.path({ filters: ["directory"], allowCreate: true })).description("持久化路径映射"),
    readOnlyPaths: Schema.dict(Schema.path({ filters: ["directory"] })).description("只读路径映射"),
    overlayPaths: Schema.dict(Schema.path({ filters: ["directory"] })).description(
      "覆盖层路径映射：读取宿主目录，写入保留在虚拟文件系统中",
    ),
    timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
    enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
    skillPaths: Schema.array(Schema.path({ filters: ["directory", "file"], allowCreate: true }))
      .default([])
      .description("技能文件路径列表"),
    /**
     * Python and JavaScript execution are disabled due to wasm loader issues in the current environment.
     * https://github.com/vercel-labs/just-bash/issues/159
     */
    // enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
    // enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
  });

  public readonly ctx: Context;
  public readonly config: WorkspacePluginConfig;
  public readonly logger: Logger;

  private workspaces = new Map<string, Workspace>();
  private skills: Skill[] = [];
  private normalizedMounts?: {
    persistPaths: Record<string, string>;
    readOnlyPaths: Record<string, string>;
    overlayPaths: Record<string, string>;
  };
  private disposeAgentPlugin?: () => void;
  private disposeSchemes: Array<() => void> = [];

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
    for (const dispose of this.disposeSchemes.splice(0)) dispose();

    const normalizedMounts = assertValidMountConfig({
      persistPaths: this.resolveMountMap(this.config.persistPaths),
      readOnlyPaths: this.resolveMountMap(this.config.readOnlyPaths),
      overlayPaths: this.resolveMountMap(this.config.overlayPaths),
    });
    assertNoSkillMountOverlap(normalizedMounts);

    for (const hostPath of Object.values(normalizedMounts.persistPaths)) {
      await mkdir(hostPath, { recursive: true });
    }
    await this.assertExistingDirectoryMounts(normalizedMounts.readOnlyPaths, "readOnlyPaths");
    await this.assertExistingDirectoryMounts(normalizedMounts.overlayPaths, "overlayPaths");

    this.normalizedMounts = normalizedMounts;

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

    const skillMounts: Record<string, string> = {};
    for (const skill of skillCatalog) {
      skillMounts[`/skills/${skill.name}`] = skill.baseDir;
    }
    this.normalizedMounts = assertValidMountConfig({
      ...normalizedMounts,
      readOnlyPaths: { ...normalizedMounts.readOnlyPaths, ...skillMounts },
    });

    this.logger.info(`Persist paths: ${JSON.stringify(normalizedMounts.persistPaths, null, 2)}`);
    this.logger.info(`Read-only paths: ${JSON.stringify(this.normalizedMounts.readOnlyPaths, null, 2)}`);
    this.logger.info(`Overlay paths: ${JSON.stringify(normalizedMounts.overlayPaths, null, 2)}`);

    if (skillCatalog.length > 0) {
      this.disposeSchemes.push(
        this.ctx.yesimbot.registerResourceScheme("skill", SKILL_SCHEME_PROMPT, (scope, uri, options) =>
          this.openSkillFromCatalog(skillCatalog, scope, uri, options),
        ),
      );
    }
    this.disposeSchemes.push(
      this.ctx.yesimbot.registerResourceScheme("workspace", WORKSPACE_SCHEME_PROMPT, this.openWorkspace.bind(this)),
    );

    this.disposeAgentPlugin = this.ctx.yesimbot.registerChannelPlugin(({ scope }) => {
      const runtimeSkills = skillCatalog.map((skill) => ({ ...skill }));
      return {
        name: "workspace",
        tools: async () => {
          const workspace = await this.getOrCreateWorkspace(scope);
          return createBashToolSet(workspace);
        },
        appendSystemPrompt: async () => {
          const workspace = await this.getOrCreateWorkspace(scope);
          return [formatWorkspacePrompt(workspace), formatSkillsForPrompt(runtimeSkills)].filter(Boolean);
        },
      } satisfies AgentPlugin;
    });

    this.logger.success("Workspace plugin started");
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.disposeSchemes.splice(0)) {
      dispose();
    }
    this.workspaces.clear();
    this.skills.splice(0);
    this.normalizedMounts = undefined;
    this.logger.info("Workspace plugin stopped");
  }

  private resolveMountMap(paths: Record<string, string> | undefined): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [virtualPath, hostPath] of Object.entries(paths ?? {})) {
      resolved[virtualPath] = resolve(this.ctx.baseDir, hostPath);
    }
    return resolved;
  }

  private async assertExistingDirectoryMounts(
    paths: Record<string, string>,
    kind: "readOnlyPaths" | "overlayPaths",
  ): Promise<void> {
    for (const [virtualPath, hostPath] of Object.entries(paths)) {
      let entry;
      try {
        entry = await stat(hostPath);
      } catch (error) {
        throw new Error(`${kind} mount ${virtualPath} host path does not exist: ${hostPath}`, {
          cause: error,
        });
      }
      if (!entry.isDirectory()) {
        throw new Error(`${kind} mount ${virtualPath} host path is not a directory: ${hostPath}`);
      }
    }
  }

  private async getOrCreateWorkspace(channel: ChannelScope): Promise<Workspace> {
    const key = JSON.stringify(
      channel.type === "direct"
        ? [channel.platform, channel.selfId, channel.channelId]
        : [channel.platform, channel.channelId],
    );
    const existing = this.workspaces.get(key);
    if (existing) {
      return existing;
    }

    if (!this.normalizedMounts) {
      throw new Error("Workspace plugin has not been started");
    }

    const workspaceRoot = join(await this.ctx.yesimbot.getStoragePath(channel), "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    const workspace = new Workspace(this.createWorkspaceConfig(workspaceRoot));
    await workspace.init();
    this.workspaces.set(key, workspace);
    return workspace;
  }

  private createWorkspaceConfig(root: string): WorkspaceConfig {
    return {
      root,
      filesystem: {
        persistPaths: this.normalizedMounts?.persistPaths,
        readOnlyPaths: this.normalizedMounts?.readOnlyPaths,
        overlayPaths: this.normalizedMounts?.overlayPaths,
      },
      bash: {
        cwd: this.config.cwd,
        timeoutMs: this.config.timeoutMs,
        network: this.config.enableNetwork ? {} : undefined,
        // python: this.config.enablePython,
        // javascript: this.config.enableJavascript,
      },
    };
  }

  private async openSkillFromCatalog(
    skills: readonly Skill[],
    _scope: ChannelScope,
    uri: string,
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }> {
    const parsed = parseSkillUri(uri);
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
    scope: ChannelScope,
    uri: string,
    options: { signal: AbortSignal; maxBytes: number },
  ): Promise<{ bytes: Uint8Array; mediaType?: string; filename?: string }> {
    const relativePath = parseWorkspaceUri(uri);
    if (!relativePath) throw new Error("Invalid workspace URI");
    const root = join(await this.ctx.yesimbot.getStoragePath(scope), "workspace");
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

async function readBoundedFile(
  filePath: string,
  options: { signal: AbortSignal; maxBytes: number },
): Promise<Uint8Array> {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error("Resource path is not a file");
  if (metadata.size > options.maxBytes) throw new Error("Resource file exceeds read limit");
  const bytes = new Uint8Array(await readFile(filePath, { signal: options.signal }));
  if (bytes.byteLength > options.maxBytes) throw new Error("Resource file exceeds read limit");
  return bytes;
}

const SKILL_SCHEME_PROMPT =
  "读取已注册技能文件：skill://<skill-name>/<relative-path>。执行技能脚本请使用 /skills/<skill-name>/... 虚拟路径。";

const WORKSPACE_SCHEME_PROMPT =
  'workspace:///relative/path 是频道工作区文件的对外引用，与沙箱内的 /home/workspace/relative/path 是同一个文件。沙箱内部操作用 readFile/bash 的 /home/workspace/... 路径，bash 不接受 workspace:// 形式。把工作区文件发出去时可用作 img/file 的 src，例如 <img src="workspace:///out/chart.png"/>。';

function assertNoSkillMountOverlap(mounts: {
  persistPaths: Record<string, string>;
  readOnlyPaths: Record<string, string>;
  overlayPaths: Record<string, string>;
}): void {
  for (const paths of Object.values(mounts)) {
    for (const mountPoint of Object.keys(paths)) {
      if (mountPoint === "/skills" || mountPoint.startsWith("/skills/")) {
        throw new Error(`${mountPoint} is a reserved Skill mount point`);
      }
    }
  }
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
