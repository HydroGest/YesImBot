import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

import type { AgentPlugin, ToolCallContext, ToolHookContext, ToolResultContext } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema, type Bot } from "koishi";
import type { ChannelResources, ChannelScope, ResourceReader } from "koishi-plugin-yesimbot";

import { createBashToolSet, type WorkspaceBashBackend } from "./bash-tool";
import { createHostRunner, type HostRunner } from "./host-engine";
import { createHostApprovalBroker, createHostPolicy, type HostApprovalBroker, type HostApprovalRecord, type HostApprovalRequest } from "./host-policy";
import { normalizeMounts, type NormalizedMountSpec } from "./mounts";
import { formatHostWorkspacePrompt, formatWorkspacePrompt } from "./prompt";
import { formatSkillsForPrompt, loadSkills, type Skill } from "./skills";
import type { BashConfig, MountSpec, SandboxBashConfig, WorkspacePluginConfig } from "./types";
import { type SandboxWorkspaceConfig, Workspace } from "./workspace";
const SKILL_SCHEME_PROMPT = "读取已注册技能文件：skill://<skill-name>/<relative-path>。执行技能脚本请使用 /skills/<skill-name>/... 虚拟路径。";
const WORKSPACE_SCHEME_PROMPT =
  'workspace:///relative/path 是频道工作区文件的对外引用，与沙箱内的 /home/workspace/relative/path 是同一个文件。沙箱内部操作用 readFile/bash 的 /home/workspace/... 路径，bash 不接受 workspace:// 形式。把工作区文件发出去时可用作 img/file 的 src，例如 <img src="workspace:///out/chart.png"/>。';
const HOST_TOOL_NAMES = new Set(["bash", "readFile", "writeFile"]);
type HostIdentity = { readonly uid: number; readonly gid: number };
export default class WorkspacePlugin {
  public static name = "yesimbot-workspace";
  public static usage = "工作区插件，提供虚拟文件系统和 Bash 沙箱环境";
  public static inject = ["yesimbot"];

  public static Config: Schema<WorkspacePluginConfig> = Schema.object({
    bash: Schema.intersect([
      Schema.object({ mode: Schema.union(["sandbox", "host"]).required() }),
      Schema.union([
        Schema.object({
          mode: Schema.const("sandbox").required(),
          cwd: Schema.string().default("/home/workspace").description("虚拟文件系统默认目录"),
          mounts: Schema.array(
            Schema.object({
              source: Schema.string().min(1).required(),
              target: Schema.string().min(1).required(),
              mode: Schema.union([Schema.const("rw"), Schema.const("ro"), Schema.const("overlay")]).required(),
            }).role("table"),
          )
            .required()
            .description("Sandbox 挂载声明"),
          timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
          enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
          /**
           * Python/JavaScript 执行依赖 just-bash 的 wasm worker。Workspace 通过动态
           * import 固定加载 just-bash 的 ESM bundle，避免 CJS bundle 中 esbuild 把
           * import.meta 替换成 {} 导致 worker 路径解析失败（"Invalid URL"）。
           * */
          enablePython: Schema.boolean().default(false).description("启用 Python 执行"),
          enableJavascript: Schema.boolean().default(false).description("启用 JavaScript 执行"),
        }),
        Schema.object({
          mode: Schema.const("host").required(),
          allowedChannels: Schema.array(
            Schema.object({
              platform: Schema.string().min(1).required(),
              channelId: Schema.string().min(1).required(),
              type: Schema.union([Schema.const("shared"), Schema.const("direct")]),
              selfId: Schema.string().min(1),
            }),
          )
            .role("table")
            .required(),
          hostRoots: Schema.array(
            Schema.object({ path: Schema.string().min(1).required(), mode: Schema.union([Schema.const("ro"), Schema.const("rw")]).required() }),
          )
            .role("table")
            .required(),
          identity: Schema.object({ uid: Schema.natural().required(), gid: Schema.natural().required() }).role("table").required(),
        }),
      ]),
    ]).description("Bash 沙箱配置"),
    skillPaths: Schema.array(Schema.path({ filters: ["directory", "file"], allowCreate: true })),
  });

  public readonly ctx: Context;
  public readonly config: WorkspacePluginConfig;
  public readonly logger: Logger;

  private workspaces = new Map<string, Workspace>();
  private skills: Skill[] = [];
  private skillCatalog: readonly Skill[] = [];
  private sandbox?: BashConfig;
  private normalizedMounts?: readonly NormalizedMountSpec[];
  private disposeAgentPlugin?: () => void;
  private disposeReaders: Array<() => void> = [];
  private disposeCommands: Array<() => void> = [];
  private hostApprovalBroker?: HostApprovalBroker;
  private hostRunner?: HostRunner;

  constructor(ctx: Context, config: WorkspacePluginConfig) {
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("workspace");
    ctx.on("ready", this.start.bind(this));
    ctx.on("dispose", this.stop.bind(this));
  }

  public async start(): Promise<void> {
    this.logger.info("Starting workspace plugin...");

    this.hostApprovalBroker?.stop();
    this.hostApprovalBroker = undefined;
    await this.stopHostRunner();
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.disposeReaders.splice(0)) dispose();
    for (const dispose of this.disposeCommands.splice(0)) dispose();

    const sandbox = this.getSandboxConfig();
    if (sandbox.mode === "host") {
      this.hostApprovalBroker = createHostApprovalBroker({ audit: (event) => this.logger.info(`Host approval audit: ${JSON.stringify(event)}`) });
      this.registerHostApprovalCommands(this.hostApprovalBroker);
    }
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

    if (sandbox.mode === "sandbox") {
      const userMounts: MountSpec[] = [...(sandbox?.mounts ?? [])];
      assertNoSkillMountOverlap(userMounts);
      const skillMounts: MountSpec[] = skillCatalog.map((skill) => ({ source: skill.baseDir, target: `/skills/${skill.name}`, mode: "ro" as const }));
      const requestedMounts = [...userMounts, ...skillMounts];
      this.normalizedMounts = await normalizeMounts(requestedMounts, this.ctx.baseDir);
      this.logger.info(`Sandbox mounts: ${JSON.stringify(this.normalizedMounts, null, 2)}`);
    } else {
      // Host mode must not initialize any virtual mount state.
      this.normalizedMounts = undefined;
    }

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

  public async setup(scope: ChannelScope, bot: Bot): Promise<AgentPlugin | null> {
    const sandbox = this.sandbox;
    if (!sandbox) return null;
    const resources = await this.ctx.yesimbot.resource.get(scope);
    const runtimeSkills = this.skillCatalog.map((skill) => ({ ...skill }));
    if (sandbox.mode === "host") return this.createHostAgentPlugin(scope, bot, resources, runtimeSkills, sandbox);
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
    this.hostApprovalBroker?.stop();
    this.hostApprovalBroker = undefined;
    await this.stopHostRunner();
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    for (const dispose of this.disposeReaders.splice(0)) dispose();
    for (const dispose of this.disposeCommands.splice(0)) dispose();
    this.workspaces.clear();
    this.skillCatalog = [];
    this.sandbox = undefined;
    this.logger.info("Workspace plugin stopped");
  }

  private async stopHostRunner(): Promise<void> {
    const runner = this.hostRunner;
    this.hostRunner = undefined;
    if (runner) await runner.stop();
  }
  private registerHostApprovalCommands(broker: HostApprovalBroker): void {
    type CommandAction = (
      argv: { readonly session?: { readonly user?: { readonly authority?: number; readonly id?: string } } },
      requestId?: string,
    ) => unknown;
    type Command = { action: (handler: CommandAction) => Command; dispose?: () => void };
    type CommandContext = { command?: (name: string, description?: string, options?: Record<string, unknown>) => Command };
    const register = (this.ctx as unknown as CommandContext).command;
    if (!register) return;

    const add = (name: string, description: string, action: CommandAction): void => {
      const command = register.call(this.ctx, name, description, { authority: 5 });
      command.action(action);
      if (command.dispose) this.disposeCommands.push(() => command.dispose?.());
    };
    const authorized = (argv: { readonly session?: { readonly user?: { readonly authority?: number } } }): boolean =>
      Number(argv.session?.user?.authority ?? 0) >= 5;

    add("yesimbot.workspace.approvals", "列出待审批的 Host 调用", (argv) => {
      if (!authorized(argv)) return "权限不足";
      const records = broker.list();
      if (records.length === 0) return "没有待审批的 Host 调用";
      return records
        .map((record) => `${record.requestId} [${record.riskTags.join(", ")}] expires=${new Date(record.expiresAt).toISOString()} ${record.summary}`)
        .join("\n");
    });
    add("yesimbot.workspace.approve <requestId>", "批准 Host 调用", (argv, requestId) => {
      if (!authorized(argv)) return "权限不足";
      const record = requestId ? broker.list().find((candidate) => candidate.requestId === requestId) : undefined;
      if (!record) return "审批请求不存在或已过期";
      const actor = argv.session?.user?.id ?? "authority-5";
      return broker.approve(record.requestId, record.fingerprint, actor) ? "已批准" : "审批请求已失效";
    });
    add("yesimbot.workspace.reject <requestId>", "拒绝 Host 调用", (argv, requestId) => {
      if (!authorized(argv)) return "权限不足";
      const record = requestId ? broker.list().find((candidate) => candidate.requestId === requestId) : undefined;
      if (!record) return "审批请求不存在或已过期";
      const actor = argv.session?.user?.id ?? "authority-5";
      return broker.reject(record.requestId, record.fingerprint, actor) ? "已拒绝" : "审批请求已失效";
    });
  }
  private async getHostWorkspaceDir(resources: ChannelResources): Promise<string> {
    const workspaceDir = join(resources.path, "workspace");
    await mkdir(workspaceDir, { recursive: true });
    return realpath(workspaceDir);
  }

  private async createHostAgentPlugin(
    scope: ChannelScope,
    bot: Bot,
    resources: ChannelResources,
    runtimeSkills: Skill[],
    config: Extract<BashConfig, { mode: "host" }>,
  ): Promise<AgentPlugin> {
    const broker = this.hostApprovalBroker;
    const admission = createHostPolicy({ allowedChannels: config.allowedChannels });
    if (!broker) return createBlockedHostAgentPlugin("host-approval-unavailable");
    if (!admission.checkChannel(scope)) return createBlockedHostAgentPlugin("host-channel-not-allowed");

    const resourcesState = await this.createHostResources(scope, resources, config);
    if (!resourcesState) return createBlockedHostAgentPlugin("host-runtime-unavailable");

    const { workspaceDir, policy, runner } = resourcesState;
    const backend = createHostBackend({ scope, workspaceDir, policy, runner, identity: config.identity });
    let toolsPromise: ReturnType<typeof createBashToolSet> | undefined;
    const approvedCalls = new Map<string, { request: HostApprovalRecord; startedAt: number }>();
    return {
      name: "workspace",
      tools: async () => {
        toolsPromise ??= createBashToolSet({ backend, destination: workspaceDir, environment: "host" });
        return toolsPromise;
      },
      appendSystemPrompt: async () => {
        return [formatHostWorkspacePrompt({ workspaceDir, timeoutMs: 30_000, hostRoots: config.hostRoots }), formatSkillsForPrompt(runtimeSkills)].filter(
          Boolean,
        );
      },
      beforeToolCall: async (call: ToolCallContext, context: ToolHookContext) => {
        if (!HOST_TOOL_NAMES.has(call.toolName)) return { type: "allow" } as const;
        try {
          const decision = policy.classify(scope, call.toolName, call.args);
          if (decision.kind === "allow") return { type: "allow" } as const;
          const request: HostApprovalRequest = {
            scope,
            toolName: call.toolName,
            cwd: workspaceDir,
            policyRevision: "host-policy-v1",
            fingerprint: decision.fingerprint,
            riskTags: decision.riskTags,
            summary: decision.summary,
            notify: async (record) => {
              await bot.sendMessage(scope.channelId, formatHostApprovalNotification(record));
            },
          };
          const approval = broker.request(request, context.signal ?? new AbortController().signal);
          const outcome = await approval;
          if (outcome !== "approved") return { type: "block", reason: `host-approval-${outcome}` } as const;
          const pendingRecord = broker.find(request.fingerprint);
          if (pendingRecord) approvedCalls.set(call.toolCallId, { request: pendingRecord, startedAt: Date.now() });
          return { type: "allow" } as const;
        } catch {
          return { type: "block", reason: "host-policy-denied" } as const;
        }
      },
      afterToolCall: async (result: ToolResultContext, context: ToolHookContext) => {
        const execution = approvedCalls.get(result.toolCallId);
        if (!execution) return;
        approvedCalls.delete(result.toolCallId);
        const value = result.result;
        const metadata = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
        broker.recordExecution(execution.request, {
          durationMs: Date.now() - execution.startedAt,
          exitCode: typeof metadata?.exitCode === "number" ? metadata.exitCode : undefined,
          signal: typeof metadata?.signal === "string" ? metadata.signal : undefined,
          truncated: typeof metadata?.truncated === "boolean" ? metadata.truncated : undefined,
          cancelled: context.signal?.aborted || undefined,
        });
      },
    } satisfies AgentPlugin;
  }

  private async createHostResources(
    scope: ChannelScope,
    resources: ChannelResources,
    config: Extract<BashConfig, { mode: "host" }>,
  ): Promise<{ workspaceDir: string; policy: ReturnType<typeof createHostPolicy>; runner: HostRunner } | undefined> {
    if (!(await hostExecutionPrerequisites(config.identity))) return undefined;
    if (!(await hostRootsAreUsable(config.hostRoots))) return undefined;

    let workspaceDir: string;
    try {
      workspaceDir = await this.getHostWorkspaceDir(resources);
    } catch {
      return undefined;
    }
    if (!(await hostIdentityCanSpawn(config.identity))) return undefined;

    const policy = createHostPolicy({
      allowedChannels: config.allowedChannels,
      hostRoots: config.hostRoots,
      workspaceRoot: workspaceDir,
      cwd: workspaceDir,
      policyRevision: "host-policy-v1",
    });
    if (!policy.checkChannel(scope)) return undefined;

    if (!this.hostRunner) {
      try {
        this.hostRunner = createHostRunner();
      } catch {
        return undefined;
      }
    }
    return { workspaceDir, policy, runner: this.hostRunner };
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
    return {
      root,
      filesystem: { ...workspaceMountMaps(mounts) },
      bash: {
        cwd: sandbox.cwd ?? "/home/workspace",
        timeoutMs: sandbox.timeoutMs,
        network: sandbox.enableNetwork ? {} : undefined,
        python: sandbox.enablePython,
        javascript: sandbox.enableJavascript,
      },
    };
  }

  private getSandboxConfig(): BashConfig {
    const bash = this.config.bash;
    if (bash?.mode === "host") {
      return {
        mode: "host",
        allowedChannels: bash.allowedChannels.map((rule) => ({ ...rule })),
        hostRoots: bash.hostRoots.map((root) => ({ ...root })),
        identity: { ...bash.identity },
      };
    }
    return {
      mode: "sandbox",
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
function formatHostApprovalNotification(record: HostApprovalRecord): string {
  return [
    `Host approval request ${record.requestId}`,
    `Risks: ${record.riskTags.join(", ") || "unspecified"}`,
    record.summary,
    `Expires: ${new Date(record.expiresAt).toISOString()}`,
    "An authority-5 administrator must use yesimbot.workspace.approve <requestId> or yesimbot.workspace.reject <requestId>.",
  ].join("\n");
}
async function hostExecutionPrerequisites(identity: HostIdentity): Promise<boolean> {
  if (process.platform === "win32") return false;
  if (!Number.isSafeInteger(identity.uid) || identity.uid < 0) return false;
  if (!Number.isSafeInteger(identity.gid) || identity.gid < 0) return false;
  if (!["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"].includes(process.platform)) return false;

  try {
    await access("/bin/bash", fsConstants.X_OK);
    // Linux uses setpriv so supplementary groups are cleared before Bash starts.
    // Without it, the configured uid/gid would not establish the promised identity boundary.
    if (process.platform === "linux") await access("/usr/bin/setpriv", fsConstants.X_OK);
    const [passwd, groups] = await Promise.all([readFile("/etc/passwd", "utf8"), readFile("/etc/group", "utf8")]);
    const uid = String(identity.uid);
    const gid = String(identity.gid);
    const hasUid = passwd.split("\n").some((line) => line.split(":", 4)[2] === uid);
    const hasGid = groups.split("\n").some((line) => line.split(":", 4)[2] === gid);
    return hasUid && hasGid;
  } catch {
    return false;
  }
}
async function hostRootsAreUsable(roots: readonly { readonly path: string; readonly mode: "ro" | "rw" }[] | undefined): Promise<boolean> {
  if (!Array.isArray(roots)) return false;
  for (const root of roots) {
    if (!root || typeof root.path !== "string" || root.path.length === 0 || root.path.includes("\0") || (root.mode !== "ro" && root.mode !== "rw")) {
      return false;
    }
    try {
      const canonical = await realpath(resolve(root.path));
      const metadata = await stat(canonical);
      if (!metadata.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}
async function hostIdentityCanSpawn(identity: HostIdentity): Promise<boolean> {
  if (process.platform !== "linux") return true;
  return new Promise((resolveProbe) => {
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      resolveProbe(result);
    };
    const child = spawn("/usr/bin/setpriv", ["--clear-groups", "--reuid", String(identity.uid), "--regid", String(identity.gid), "--", "/bin/true"], {
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, 500);
    timer.unref();
    child.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      finish(code === 0 && signal === null);
    });
  });
}
function createBlockedHostAgentPlugin(reason: string): AgentPlugin {
  return {
    name: "workspace",
    tools: async () => [],
    beforeToolCall: async (call) => (HOST_TOOL_NAMES.has(call.toolName) ? ({ type: "block", reason } as const) : ({ type: "allow" } as const)),
  } satisfies AgentPlugin;
}
function createHostBackend(options: {
  scope: ChannelScope;
  workspaceDir: string;
  policy: ReturnType<typeof createHostPolicy>;
  runner: HostRunner;
  identity: HostIdentity;
}): WorkspaceBashBackend {
  const assertAdmission = (): void => {
    if (!options.policy.checkChannel(options.scope)) throw new Error("Host channel is not allowed");
  };

  return {
    async executeCommand(command, executionOptions) {
      assertAdmission();
      if (executionOptions?.cwd !== undefined && executionOptions.cwd !== options.workspaceDir) {
        throw new Error("Host cwd is fixed to the channel workspace");
      }
      return options.runner.run({
        command,
        cwd: options.workspaceDir,
        env: { ...process.env },
        uid: options.identity.uid,
        gid: options.identity.gid,
        signal: executionOptions?.signal ?? new AbortController().signal,
      });
    },

    async readFile(path) {
      assertAdmission();
      options.policy.checkFile("readFile", path);
      return readFile(path, "utf8");
    },

    async writeFiles(files) {
      assertAdmission();
      for (const file of files) options.policy.checkFile("writeFile", file.path);
      for (const file of files) await writeFile(file.path, file.content);
    },
  };
}
