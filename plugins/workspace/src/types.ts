export type WorkspaceMountKind = "persistent" | "read-only" | "overlay";

// ============================================================================
// 配置类型
// ============================================================================

export interface MountSpec {
  readonly source: string;
  readonly target: string;
  readonly mode: "rw" | "ro" | "overlay";
}

export interface SandboxBashConfig {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly mounts?: MountSpec[];
  readonly enableNetwork?: boolean;
  readonly enablePython?: boolean;
  readonly enableJavascript?: boolean;
}

export interface WorkspacePluginConfig {
  readonly bash?: SandboxBashConfig;
  readonly skillPaths?: string[];
}

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
  collision?: { resourceType: "extension" | "skill" | "prompt" | "theme"; name: string; winnerPath: string; loserPath: string };
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
