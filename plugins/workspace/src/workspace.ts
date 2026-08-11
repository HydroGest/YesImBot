import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type * as JustBashModule from "just-bash";
import type { Bash, IFileSystem, InitialFiles, MountableFs, NetworkConfig } from "just-bash";

import type { WorkspaceBashBackend } from "./bash-tool";
import { createGitLazyCommand, type GitCommandOptions } from "./git";
import { assertValidMountConfig, DEFAULT_WORKSPACE_MOUNT } from "./mounts";
import type { WorkspaceMountSummary } from "./types";

const DEFAULT_SYSTEM_BIN_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"] as const;
const DEFAULT_SYSTEM_PATH = DEFAULT_SYSTEM_BIN_PATHS.join(":");
const USR_LOCAL_BIN_PLACEHOLDER = "/usr/local/bin/.keep";

/**
 * Bootstrap script injected into js-exec to fix Node.js compatibility.
 *
 * just-bash's js-exec bridge returns stat results as plain objects with boolean
 * fields (`isFile: true`), but Node.js's `fs.statSync()` returns `Stats` objects
 * with **methods** (`isFile(): boolean`). Code using the standard Node.js pattern
 * `stat.isFile()` fails with "not a function" without this shim.
 *
 * Additionally, `mtime` is returned as an ISO string from the bridge; Node.js
 * returns a `Date` object.
 */
const STAT_COMPAT_BOOTSTRAP = `(function() {
  var _fs = globalThis.fs;
  var _origStatSync = _fs.statSync;
  var _origLstatSync = _fs.lstatSync;

  function wrapStatResult(raw) {
    if (!raw || typeof raw !== 'object') return raw;
    var _isFile = !!raw.isFile;
    var _isDir = !!raw.isDirectory;
    var _isSym = !!raw.isSymbolicLink;
    raw.isFile = function() { return _isFile; };
    raw.isDirectory = function() { return _isDir; };
    raw.isSymbolicLink = function() { return _isSym; };
    raw.isBlockDevice = function() { return false; };
    raw.isCharacterDevice = function() { return false; };
    raw.isFIFO = function() { return false; };
    raw.isSocket = function() { return false; };
    if (typeof raw.mtime === 'string') raw.mtime = new Date(raw.mtime);
    if (typeof raw.atimeMs === 'undefined') raw.atimeMs = raw.mtime ? raw.mtime.getTime() : 0;
    if (typeof raw.mtimeMs === 'undefined') raw.mtimeMs = raw.mtime ? raw.mtime.getTime() : 0;
    return raw;
  }

  _fs.statSync = function(path) { return wrapStatResult(_origStatSync(path)); };
  _fs.lstatSync = function(path) { return wrapStatResult(_origLstatSync(path)); };

  // Also patch the promises namespace to return Node.js-compatible results
  if (_fs.promises) {
    var _origPromisesStat = _fs.promises.stat;
    var _origPromisesLstat = _fs.promises.lstat;
    if (_origPromisesStat) {
      _fs.promises.stat = function(path) {
        try { return Promise.resolve(wrapStatResult(_origStatSync(path))); }
        catch(e) { return Promise.reject(e); }
      };
    }
    if (_origPromisesLstat) {
      _fs.promises.lstat = function(path) {
        try { return Promise.resolve(wrapStatResult(_origLstatSync(path))); }
        catch(e) { return Promise.reject(e); }
      };
    }
  }
})();`;

type JustBash = typeof JustBashModule;

export interface SandboxWorkspaceConfig {
  root: string;
  filesystem: {
    persistPaths?: Record<string, string>;
    readOnlyPaths?: Record<string, string>;
    overlayPaths?: Record<string, string>;
    initialFiles?: Record<string, string>;
  };
  bash: {
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    executionLimits?: { maxCallDepth?: number; maxCommandCount?: number; maxLoopIterations?: number; maxAwkIterations?: number; maxSedIterations?: number };
    network?: NetworkConfig;
    python?: boolean;
    javascript?: boolean;
  };
  git?: GitCommandOptions;
}

export class Workspace {
  public readonly bash: Bash;
  public readonly config: SandboxWorkspaceConfig;
  public readonly fs: MountableFs;
  public readonly mounts: WorkspaceMountSummary[];
  public readonly backend: WorkspaceBashBackend;
  public readonly destination: string;
  public readonly environment = "sandbox" as const;
  private _initialized = false;

  public static async create(config: SandboxWorkspaceConfig): Promise<Workspace> {
    // Exception (static import cannot work): just-bash 的 CJS bundle
    // （dist/bundle/index.cjs）由 esbuild 编译，import.meta 被替换成 {}；
    // python3/js-exec 用 new URL("./worker.js", import.meta.url) 解析 worker 时
    // 得到 undefined base URL（"Invalid URL"）。静态 import 在 CJS bundle 中会走
    // exports 的 require 条件加载坏掉的 CJS build；动态 import 固定走 import 条件
    // 加载 ESM bundle，worker 路径用真实 import.meta.url 解析。
    return new Workspace(config, await import("just-bash"));
  }

  private constructor(config: SandboxWorkspaceConfig, jb: JustBash) {
    this.config = config;
    this.destination = config.bash.cwd;
    const built = this.buildFilesystem(jb);
    this.fs = built.fs;
    this.mounts = built.mounts;

    this.bash = new jb.Bash({
      fs: this.fs,
      cwd: config.bash.cwd,
      env: withDefaultSystemPath(config.bash?.env),
      executionLimits: config.bash?.executionLimits,
      network: config.bash?.network,
      python: config.bash?.python ?? false,
      javascript: config.bash?.javascript ? { bootstrap: STAT_COMPAT_BOOTSTRAP } : false,
      customCommands: [createGitLazyCommand(this.fs, config.git)],
    });
    this.backend = {
      executeCommand: (command, options) => this.executeCommand(command, options),
      readFile: (path) => this.fs.readFile(path, "utf8"),
      writeFiles: (files) => this.writeFiles(files),
    };
  }

  private buildFilesystem(jb: JustBash): { fs: MountableFs; mounts: WorkspaceMountSummary[] } {
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
      fs: new jb.MountableFs({
        base: createDefaultBaseFilesystem(memoryFiles, jb),
        mounts: [
          { mountPoint: DEFAULT_WORKSPACE_MOUNT, filesystem: new jb.ReadWriteFs({ root }) },
          ...Object.entries(mounts.persistPaths).map(([mountPoint, hostPath]) => ({ mountPoint, filesystem: new jb.ReadWriteFs({ root: resolve(hostPath) }) })),
          ...Object.entries(mounts.readOnlyPaths).map(([mountPoint, hostPath]) => ({
            mountPoint,
            filesystem: new jb.OverlayFs({ root: resolve(hostPath), mountPoint: "/", readOnly: true }),
          })),
          ...Object.entries(mounts.overlayPaths).map(([mountPoint, hostPath]) => ({
            mountPoint,
            filesystem: new jb.OverlayFs({ root: resolve(hostPath), mountPoint: "/" }),
          })),
        ],
      }),
      mounts: [
        { path: DEFAULT_WORKSPACE_MOUNT, kind: "persistent" },
        ...Object.keys(mounts.persistPaths).map((path) => ({ path, kind: "persistent" as const })),
        ...Object.keys(mounts.readOnlyPaths).map((path) => ({ path, kind: "read-only" as const })),
        ...Object.keys(mounts.overlayPaths).map((path) => ({ path, kind: "overlay" as const })),
      ],
    };
  }

  public async init(): Promise<void> {
    if (this._initialized) return;
    await this.writeOptionalCommandStubs();
    this._initialized = true;
  }

  private async executeCommand(
    command: string,
    options?: { cwd?: string; signal?: AbortSignal },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const timeoutSignal = AbortSignal.timeout(this.defaultTimeoutMs);
      const signal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      const result = await this.bash.exec(command, { cwd: options?.cwd ?? this.config.bash.cwd, signal });

      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return { stdout: "", stderr: `Command timed out after ${this.defaultTimeoutMs}ms`, exitCode: 124 };
      }

      return { stdout: "", stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
    }
  }

  private async writeFiles(files: readonly { path: string; content: string }[]): Promise<void> {
    for (const file of files) {
      await this.fs.writeFile(file.path, file.content, "utf8");
    }
  }

  /**
   * MountableFs 没有 writeFileSync，just-bash 的 Bash 构造函数只会为支持
   * writeFileSync 的文件系统写 /bin、/usr/bin 命令桩，因此 PATH 解析找不到
   * python3/js-exec（即使 python/javascript 已启用）。这里补写与 just-bash
   * 相同路径的命令桩；isTrustedCommandStub 只校验路径。
   */
  private async writeOptionalCommandStubs(): Promise<void> {
    const names: string[] = [];
    if (this.config.bash?.python) {
      names.push("python3", "python");
    }
    if (this.config.bash?.javascript) {
      names.push("js-exec", "node");
    }
    // Always register git stub since the custom command is always available
    names.push("git");
    if (names.length === 0) return;

    for (const name of names) {
      const stub = `#!/bin/bash\n# Built-in command: ${name}\n`;
      await this.fs.writeFile(`/bin/${name}`, stub, "utf8");
      await this.fs.writeFile(`/usr/bin/${name}`, stub, "utf8");
    }
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

function createDefaultBaseFilesystem(memoryFiles: InitialFiles, jb: JustBash): IFileSystem {
  const files: InitialFiles = { ...memoryFiles };
  // InMemoryFs creates parent directories for initial files; this keeps /usr/local/bin visible.
  files[USR_LOCAL_BIN_PLACEHOLDER] ??= "";

  // Reuse just-bash's own default layout so built-in command stubs stay in sync with the package.
  return new jb.Bash({ fs: new jb.InMemoryFs(files) }).fs;
}
