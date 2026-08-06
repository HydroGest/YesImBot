// ============================================================================
// 配置类型
// ============================================================================

export interface MountSpec {
  readonly source: string;
  readonly target: string;
  readonly mode: "rw" | "ro" | "overlay";
}

export interface HostChannelRule {
  readonly platform: string;
  readonly channelId: string;
  readonly type?: "shared" | "direct";
  readonly selfId?: string;
}

export interface HostRootSpec {
  readonly path: string;
  readonly mode: "ro" | "rw";
}

export interface SandboxBashConfig {
  readonly mode: "sandbox";
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly mounts?: MountSpec[];
  readonly enableNetwork?: boolean;
  readonly enablePython?: boolean;
  readonly enableJavascript?: boolean;
}

export interface HostBashConfig {
  readonly mode: "host";
  readonly allowedChannels: HostChannelRule[];
  readonly hostRoots: HostRootSpec[];
  readonly identity: {
    readonly uid: number;
    readonly gid: number;
  };
}

export type BashConfig = SandboxBashConfig | HostBashConfig;

export interface WorkspacePluginConfig {
  readonly bash?: BashConfig;
  readonly skillPaths?: string[];
}

export type WorkspaceMountKind = "persistent" | "read-only" | "overlay";

export interface WorkspaceMountSummary {
  path: string;
  kind: WorkspaceMountKind;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
}

export interface ResourceDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  path?: string;
  collision?: {
    resourceType: "extension" | "skill" | "prompt" | "theme";
    name: string;
    winnerPath: string;
    loserPath: string;
  };
}

export interface LoadSkillsResult {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
}

export interface LoadSkillsOptions {
  /** Working directory for project-local skills. */
  cwd: string;
  /** Explicit skill paths (files or directories). */
  skillPaths: string[];
}
