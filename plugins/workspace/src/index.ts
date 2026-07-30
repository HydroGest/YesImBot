import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type { ChannelScope } from "koishi-plugin-yesimbot";

import { createBashToolSet } from "./bash-tool";
import { assertValidMountConfig } from "./mounts";
import { formatWorkspacePrompt } from "./prompt";
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
}

export default class WorkspacePlugin {
  static name = "yesimbot-workspace";
  static usage = "工作区插件，提供虚拟文件系统和 Bash 沙箱环境";
  static inject = ["yesimbot"];

  static Config: Schema<WorkspacePluginConfig> = Schema.object({
    cwd: Schema.string().default("/home/workspace").description("虚拟文件系统默认目录"),
    persistPaths: Schema.dict(
      Schema.path({ filters: ["directory"], allowCreate: true }),
    ).description("持久化路径映射"),
    readOnlyPaths: Schema.dict(Schema.path({ filters: ["directory"] })).description("只读路径映射"),
    overlayPaths: Schema.dict(Schema.path({ filters: ["directory"] })).description(
      "覆盖层路径映射：读取宿主目录，写入保留在虚拟文件系统中",
    ),
    timeoutMs: Schema.number().default(30000).description("命令执行超时（毫秒）"),
    enableNetwork: Schema.boolean().default(false).description("启用网络访问"),
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
  private normalizedMounts?: {
    persistPaths: Record<string, string>;
    readOnlyPaths: Record<string, string>;
    overlayPaths: Record<string, string>;
  };
  private disposeAgentPlugin?: () => void;

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

    const normalizedMounts = assertValidMountConfig({
      persistPaths: this.resolveMountMap(this.config.persistPaths),
      readOnlyPaths: this.resolveMountMap(this.config.readOnlyPaths),
      overlayPaths: this.resolveMountMap(this.config.overlayPaths),
    });

    for (const hostPath of Object.values(normalizedMounts.persistPaths)) {
      await mkdir(hostPath, { recursive: true });
    }
    await this.assertExistingDirectoryMounts(normalizedMounts.readOnlyPaths, "readOnlyPaths");
    await this.assertExistingDirectoryMounts(normalizedMounts.overlayPaths, "overlayPaths");

    this.normalizedMounts = normalizedMounts;

    this.logger.info(`Persist paths: ${JSON.stringify(normalizedMounts.persistPaths, null, 2)}`);
    this.logger.info(`Read-only paths: ${JSON.stringify(normalizedMounts.readOnlyPaths, null, 2)}`);
    this.logger.info(`Overlay paths: ${JSON.stringify(normalizedMounts.overlayPaths, null, 2)}`);

    this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((scope) => {
      return {
        name: "workspace",
        tools: async () => {
          const workspace = await this.getOrCreateWorkspace(scope);
          return createBashToolSet(workspace);
        },
        appendSystemPrompt: async () => {
          const workspace = await this.getOrCreateWorkspace(scope);
          return formatWorkspacePrompt(workspace);
        },
      } satisfies AgentPlugin;
    });

    this.logger.success("Workspace plugin started");
  }

  public async stop(): Promise<void> {
    this.disposeAgentPlugin?.();
    this.disposeAgentPlugin = undefined;
    this.workspaces.clear();
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
}
