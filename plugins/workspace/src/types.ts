import type { NetworkConfig as BashNetworkConfig } from "just-bash";

// ============================================================================
// 配置类型
// ============================================================================

export interface WorkspaceConfig {
  /** 工作区根目录（宿主机路径） */
  root: string;

  /** 文件系统配置 */
  filesystem: {
    /** 持久化路径映射：虚拟路径 → 宿主机路径 */
    persistPaths?: Record<string, string>;
    /** 只读路径映射：虚拟路径 → 宿主机路径 */
    readOnlyPaths?: Record<string, string>;
    /** Overlay 路径映射：虚拟路径 → 宿主机路径 */
    overlayPaths?: Record<string, string>;
    /** 初始文件（注入到虚拟文件系统） */
    initialFiles?: Record<string, string>;
  };

  /** Bash 配置 */
  bash: {
    /** 默认工作目录（虚拟路径） */
    cwd: string;
    /** 默认环境变量 */
    env?: Record<string, string>;
    /** 默认超时（毫秒，默认: 30000） */
    timeoutMs?: number;
    /** 执行限制 */
    executionLimits?: ExecutionLimits;
    /** 网络配置（默认禁用） */
    network?: NetworkConfig;
    /** 启用 Python（默认: false） */
    python?: boolean;
    /** 启用 JavaScript（默认: false） */
    javascript?: boolean;
  };
}

export interface ExecutionLimits {
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
  maxAwkIterations?: number;
  maxSedIterations?: number;
}

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";

export interface NetworkConfig extends BashNetworkConfig {
  allowedUrlPrefixes?: Array<string | { url: string; transform?: Array<{ headers: Record<string, string> }> }>;
  allowedMethods?: HttpMethod[];
  dangerouslyAllowFullInternetAccess?: boolean;
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
