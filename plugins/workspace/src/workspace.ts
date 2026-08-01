import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  Bash,
  InitialFiles,
  InMemoryFs,
  type IFileSystem,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";

import { assertValidMountConfig, DEFAULT_WORKSPACE_MOUNT } from "./mounts";
import type { WorkspaceConfig, WorkspaceMountSummary } from "./types";

const DEFAULT_SYSTEM_BIN_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"] as const;
const DEFAULT_SYSTEM_PATH = DEFAULT_SYSTEM_BIN_PATHS.join(":");
const USR_LOCAL_BIN_PLACEHOLDER = "/usr/local/bin/.keep";

export class Workspace {
  public readonly bash: Bash;
  public readonly config: WorkspaceConfig;
  public readonly fs: IFileSystem;
  public readonly mounts: WorkspaceMountSummary[];
  private _initialized = false;

  constructor(config: WorkspaceConfig) {
    this.config = config;
    const built = this.buildFilesystem();
    this.fs = built.fs;
    this.mounts = built.mounts;

    this.bash = new Bash({
      fs: this.fs,
      cwd: config.bash.cwd,
      env: withDefaultSystemPath(config.bash?.env),
      executionLimits: config.bash?.executionLimits,
      network: config.bash?.network,
      python: config.bash?.python ?? false,
      javascript: config.bash?.javascript ?? false,
    });
  }

  private buildFilesystem(): {
    fs: MountableFs;
    mounts: WorkspaceMountSummary[];
  } {
    const root = resolve(this.config.root);
    const mounts = assertValidMountConfig(this.config.filesystem ?? {});
    const initialFiles = this.config.filesystem?.initialFiles ?? {};
    const memoryFiles: InitialFiles = {};
    for (const [path, to] of Object.entries(initialFiles)) {
      memoryFiles[path] = () => {
        return readFile(resolve(to), "utf-8");
      };
    }

    return {
      fs: new MountableFs({
        base: createDefaultBaseFilesystem(memoryFiles),
        mounts: [
          {
            mountPoint: DEFAULT_WORKSPACE_MOUNT,
            filesystem: new ReadWriteFs({ root }),
          },
          ...Object.entries(mounts.persistPaths).map(([mountPoint, hostPath]) => ({
            mountPoint,
            filesystem: new ReadWriteFs({ root: resolve(hostPath) }),
          })),
          ...Object.entries(mounts.readOnlyPaths).map(([mountPoint, hostPath]) => ({
            mountPoint,
            filesystem: new OverlayFs({
              root: resolve(hostPath),
              mountPoint: "/",
              readOnly: true,
            }),
          })),
          ...Object.entries(mounts.overlayPaths).map(([mountPoint, hostPath]) => ({
            mountPoint,
            filesystem: new OverlayFs({
              root: resolve(hostPath),
              mountPoint: "/",
            }),
          })),
        ],
      }),
      mounts: [
        { path: DEFAULT_WORKSPACE_MOUNT, kind: "persistent" },
        ...Object.keys(mounts.persistPaths).map((path) => ({
          path,
          kind: "persistent" as const,
        })),
        ...Object.keys(mounts.readOnlyPaths).map((path) => ({
          path,
          kind: "read-only" as const,
        })),
        ...Object.keys(mounts.overlayPaths).map((path) => ({
          path,
          kind: "overlay" as const,
        })),
      ],
    };
  }

  public async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
  }

  public get defaultTimeoutMs(): number {
    return this.config.bash?.timeoutMs ?? 30000;
  }
}

function withDefaultSystemPath(env: Record<string, string> | undefined): Record<string, string> {
  const merged = { ...env };
  const pathEntries = (merged.PATH ?? DEFAULT_SYSTEM_PATH).split(":").filter(Boolean);

  for (const path of DEFAULT_SYSTEM_BIN_PATHS) {
    if (!pathEntries.includes(path)) {
      pathEntries.push(path);
    }
  }

  merged.PATH = pathEntries.join(":");
  return merged;
}

function createDefaultBaseFilesystem(memoryFiles: InitialFiles): IFileSystem {
  const files: InitialFiles = { ...memoryFiles };
  // InMemoryFs creates parent directories for initial files; this keeps /usr/local/bin visible.
  files[USR_LOCAL_BIN_PLACEHOLDER] ??= "";

  // Reuse just-bash's own default layout so built-in command stubs stay in sync with the package.
  return new Bash({ fs: new InMemoryFs(files) }).fs;
}
