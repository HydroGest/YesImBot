import type { HttpClient } from "isomorphic-git";
import type { CustomCommand, MountableFs } from "just-bash";

// ============================================================================
// Constants
// ============================================================================

const LOCAL_SUBCOMMANDS = new Set(["init", "add", "config", "commit", "status", "log", "diff", "branch", "checkout"]);

const REMOTE_SUBCOMMANDS = new Set(["clone", "fetch", "pull"]);

const REJECTED_SUBCOMMANDS = new Set(["push"]);

const MAX_OUTPUT_BYTES = 30 * 1024;

const MAX_HTTP_RESPONSE_BYTES = 10 * 1024 * 1024;

// 10 MB for git pack data
const GIT_VERSION_STRING = "git version 2.0.0-sandbox (isomorphic-git, restricted)\n";

/** Flags that consume the next token as their value. */
const CLONE_FLAGS_WITH_VALUE = new Set(["--depth", "--branch", "-b"]);

// ============================================================================
// Types
// ============================================================================

type IsomorphicGit = typeof import("isomorphic-git");

type FsClient = {
  promises: {
    readFile: (path: string, options?: { encoding?: string }) => Promise<Uint8Array | string>;
    writeFile: (path: string, data: Uint8Array | string, options?: { mode?: number; encoding?: string }) => Promise<void>;
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    rmdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    unlink: (path: string) => Promise<void>;
    stat: (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mode: number; mtimeMs: number }>;
    lstat: (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mode: number; mtimeMs: number }>;
    readdir: (path: string) => Promise<string[]>;
    readlink: (path: string) => Promise<string>;
    symlink: (target: string, path: string) => Promise<void>;
    chmod: (path: string, mode: number) => Promise<void>;
  };
};

export interface GitCommandOptions {
  network?: { dangerouslyAllowFullInternetAccess?: boolean; denyPrivateRanges?: boolean };
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// FsClient adapter
// ============================================================================

export function createFsClient(fs: MountableFs): FsClient {
  return {
    promises: {
      async readFile(path, options) {
        if (options?.encoding === "utf8" || options?.encoding === "utf-8") {
          return fs.readFile(path, "utf8");
        }
        // Return raw bytes for binary reads
        return fs.readFileBuffer(path);
      },
      async writeFile(path, data) {
        if (typeof data === "string") {
          await fs.writeFile(path, data, "utf8");
        } else {
          // Pass Uint8Array directly — MountableFs accepts FileContent = string | Uint8Array
          await fs.writeFile(path, data);
        }
      },
      async mkdir(path) {
        await mkdirRecursive(fs, path);
      },
      async rmdir(path, options) {
        try {
          if (options?.recursive) {
            await rmRecursive(fs, path);
          } else {
            await fs.rm(path);
          }
        } catch (error) {
          // Silently ignore ENOENT — isomorphic-git cleanup may target non-existent dirs
          if (error instanceof Error && (error.message.includes("ENOENT") || error.message.includes("no such file"))) {
            return;
          }
          throw error;
        }
      },
      async unlink(path) {
        try {
          await fs.rm(path);
        } catch (error) {
          // Silently ignore ENOENT — isomorphic-git may try to remove
          // files that don't exist (e.g. .git/shallow after clone)
          if (error instanceof Error && (error.message.includes("ENOENT") || error.message.includes("no such file"))) {
            return;
          }
          throw error;
        }
      },
      async stat(path) {
        try {
          const st = await fs.stat(path);
          return wrapStat(st);
        } catch (error) {
          // Normalize to ENOENT with code property for isomorphic-git
          if (error instanceof Error && (error.message.includes("ENOENT") || error.message.includes("no such file"))) {
            const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
          const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
      },
      async lstat(path) {
        try {
          const st = await fs.stat(path);
          return wrapStat(st);
        } catch (error) {
          if (error instanceof Error && (error.message.includes("ENOENT") || error.message.includes("no such file"))) {
            const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw err;
          }
          const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
      },
      async readdir(path) {
        return fs.readdir(path);
      },
      async readlink() {
        throw new Error("symlinks are not supported in the sandbox filesystem");
      },
      async symlink() {
        throw new Error("symlinks are not supported in the sandbox filesystem");
      },
      async chmod() {
        // No-op: MountableFs doesn't track permissions
      },
    },
  };
}

export function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.startsWith("10.")) return true;
  if (hostname.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  return false;
}

// ============================================================================
// Git custom command factory (for just-bash customCommands)
// ============================================================================

/**
 * Creates a just-bash LazyCommand that registers `git` as a custom command.
 * isomorphic-git is dynamically imported on first invocation.
 */
export function createGitLazyCommand(fs: MountableFs, options: GitCommandOptions = {}): CustomCommand {
  const fsClient = createFsClient(fs);
  const http = createHttpClient(options);

  return {
    name: "git",
    trusted: true,
    load: async () => ({
      name: "git",
      trusted: true,
      async execute(args: string[], ctx: { cwd: string }) {
        const git = await import("isomorphic-git");
        if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
          return { stdout: formatGitHelp(options), stderr: "", exitCode: args.length === 0 ? 1 : 0 };
        }
        if (args[0] === "--version" || args[0] === "-v") {
          return { stdout: GIT_VERSION_STRING, stderr: "", exitCode: 0 };
        }

        const subcommand = args[0]!;
        const subArgs = args.slice(1);

        if (REJECTED_SUBCOMMANDS.has(subcommand)) {
          return { stdout: "", stderr: `git ${subcommand}: not supported in sandbox (push is not available)\n`, exitCode: 1 };
        }

        if (REMOTE_SUBCOMMANDS.has(subcommand)) {
          if (!options.network) {
            return { stdout: "", stderr: `git ${subcommand}: network access is disabled\n`, exitCode: 1 };
          }
          if (!http) {
            return { stdout: "", stderr: `git ${subcommand}: HTTP transport is not available\n`, exitCode: 1 };
          }
        }

        if (!LOCAL_SUBCOMMANDS.has(subcommand) && !REMOTE_SUBCOMMANDS.has(subcommand)) {
          return { stdout: "", stderr: `git ${subcommand}: unsupported subcommand\n`, exitCode: 1 };
        }

        try {
          const result = await dispatchSubcommand(git, fsClient, http, ctx.cwd, subcommand, subArgs);
          return truncateResult(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { stdout: "", stderr: message + "\n", exitCode: 128 };
        }
      },
    }),
  };
}

/**
 * Creates a standalone git command function for direct use (e.g. in tests).
 */
export function createGitCommand(
  fs: MountableFs,
  options: GitCommandOptions = {},
): (args: string[], opts: { cwd: string; signal?: AbortSignal }) => Promise<GitCommandResult> {
  let git: IsomorphicGit | undefined;
  const fsClient = createFsClient(fs);
  const http = createHttpClient(options);

  return async (args, { cwd }): Promise<GitCommandResult> => {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
      return { stdout: formatGitHelp(options), stderr: "", exitCode: args.length === 0 ? 1 : 0 };
    }
    if (args[0] === "--version" || args[0] === "-v") {
      return { stdout: GIT_VERSION_STRING, stderr: "", exitCode: 0 };
    }

    const subcommand = args[0]!;
    const subArgs = args.slice(1);

    if (REJECTED_SUBCOMMANDS.has(subcommand)) {
      return { stdout: "", stderr: `git ${subcommand}: not supported in sandbox (push is not available)`, exitCode: 1 };
    }

    if (REMOTE_SUBCOMMANDS.has(subcommand)) {
      if (!options.network) {
        return { stdout: "", stderr: `git ${subcommand}: network access is disabled`, exitCode: 1 };
      }
      if (!http) {
        return { stdout: "", stderr: `git ${subcommand}: HTTP transport is not available`, exitCode: 1 };
      }
    }

    if (!LOCAL_SUBCOMMANDS.has(subcommand) && !REMOTE_SUBCOMMANDS.has(subcommand)) {
      return { stdout: "", stderr: `git ${subcommand}: unsupported subcommand`, exitCode: 1 };
    }

    try {
      if (!git) git = await import("isomorphic-git");
      const result = await dispatchSubcommand(git, fsClient, http, cwd, subcommand, subArgs);
      return truncateResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: "", stderr: message, exitCode: 128 };
    }
  };
}

function wrapStat(st: Awaited<ReturnType<MountableFs["stat"]>>) {
  const mtime = st.mtime ?? new Date();
  return {
    isFile: () => st.isFile,
    isDirectory: () => st.isDirectory,
    isSymbolicLink: () => false,
    size: st.size,
    mode: st.isFile ? 0o100644 : 0o040000,
    mtimeMs: mtime.getTime(),
    mtime,
    ctimeMs: mtime.getTime(),
    ctime: mtime,
    uid: 1000,
    gid: 1000,
    dev: 0,
    ino: 0,
  };
}

async function rmRecursive(fs: MountableFs, path: string): Promise<void> {
  let st;
  try {
    st = await fs.stat(path);
  } catch {
    return; // already gone
  }
  if (st.isDirectory) {
    const entries = await fs.readdir(path);
    for (const entry of entries) {
      await rmRecursive(fs, `${path}/${entry}`);
    }
  }
  await fs.rm(path);
}

async function mkdirRecursive(fs: MountableFs, path: string): Promise<void> {
  const segments = path.split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current += "/" + segment;
    try {
      const st = await fs.stat(current);
      if (st.isDirectory) continue;
      // exists but is not a directory
      throw new Error(`ENOTDIR: not a directory, mkdir '${current}'`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOTDIR")) throw error;
      // Does not exist, create it
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        // Ignore EEXIST from race conditions
        if (!isEnoentOrExist(mkdirError, "EEXIST")) throw mkdirError;
      }
    }
  }
}

function isEnoentOrExist(error: unknown, code: string): boolean {
  if (error instanceof Error && "code" in error) {
    return (error as { code: string }).code === code;
  }
  if (error instanceof Error) {
    return error.message.includes(code);
  }
  return false;
}

// ============================================================================
// HTTP adapter
// ============================================================================

function createHttpClient(options: GitCommandOptions): HttpClient | undefined {
  if (!options.network) return undefined;

  return {
    async request(req) {
      // Only allow GET, HEAD, POST for smart HTTP protocol
      const method = (req.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        throw new Error(`Git HTTP method not allowed: ${method}`);
      }

      // Reject private/local addresses
      const urlObj = new URL(req.url);
      if (isPrivateHost(urlObj.hostname)) {
        throw new Error(`Git remote URL points to a private address: ${urlObj.hostname}`);
      }

      // Collect body if present
      let bodyBytes: Uint8Array | undefined;
      if (req.body) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of req.body) {
          chunks.push(chunk);
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        bodyBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          bodyBytes.set(chunk, offset);
          offset += chunk.length;
        }
      }

      const fetchOptions: RequestInit = {
        method,
        headers: req.headers,
        body: bodyBytes ? new Uint8Array(bodyBytes) : undefined,
        signal: req.signal as AbortSignal | undefined,
        redirect: "follow",
      };

      const response = await fetch(req.url, fetchOptions);

      // Validate the final URL after redirects — reject if redirected to private
      const finalUrl = response.url || req.url;
      if (finalUrl !== req.url) {
        const finalUrlObj = new URL(finalUrl);
        if (isPrivateHost(finalUrlObj.hostname)) {
          throw new Error(`Git remote redirected to a private address: ${finalUrlObj.hostname}`);
        }
      }

      // Convert response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Stream response body with size limit
      const responseBody = createBoundedAsyncIterator(response.body, MAX_HTTP_RESPONSE_BYTES);

      return {
        url: response.url || req.url,
        method: req.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: responseHeaders,
        body: responseBody,
      };
    },
  };
}

async function* createBoundedAsyncIterator(body: ReadableStream<Uint8Array> | null, maxBytes: number): AsyncIterableIterator<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        reader.cancel();
        throw new Error(`Git response exceeds size limit (${maxBytes} bytes)`);
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================================================
// Subcommand dispatch
// ============================================================================

async function dispatchSubcommand(
  git: IsomorphicGit,
  fs: FsClient,
  http: HttpClient | undefined,
  dir: string,
  subcommand: string,
  args: string[],
): Promise<GitCommandResult> {
  switch (subcommand) {
    case "init":
      return gitInit(git, fs, dir, args);
    case "add":
      return gitAdd(git, fs, dir, args);
    case "config":
      return gitConfig(git, fs, dir, args);
    case "commit":
      return gitCommit(git, fs, dir, args);
    case "status":
      return gitStatus(git, fs, dir);
    case "log":
      return gitLog(git, fs, dir, args);
    case "diff":
      return gitDiff(git, fs, dir);
    case "branch":
      return gitBranch(git, fs, dir, args);
    case "checkout":
      return gitCheckout(git, fs, dir, args);
    case "clone":
      return gitClone(git, fs, http!, dir, args);
    case "fetch":
      return gitFetch(git, fs, http!, dir, args);
    case "pull":
      return gitPull(git, fs, http!, dir, args);
    default:
      return { stdout: "", stderr: `git ${subcommand}: unsupported`, exitCode: 1 };
  }
}

// ============================================================================
// Local subcommands
// ============================================================================

async function gitInit(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const defaultBranch = getFlag(args, "-b") ?? getFlag(args, "--initial-branch") ?? "main";
  await git.init({ fs, dir, defaultBranch });
  return { stdout: `Initialized empty Git repository in ${dir}/.git/\n`, stderr: "", exitCode: 0 };
}

async function gitAdd(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  if (args.length === 0) {
    return { stdout: "", stderr: "Nothing specified, nothing added.", exitCode: 1 };
  }
  for (const filepath of args) {
    if (filepath === "." || filepath === "--all" || filepath === "-A") {
      // Add all files
      const status = await git.statusMatrix({ fs, dir });
      for (const [file, , workdir, stage] of status) {
        if (workdir !== stage) {
          if (workdir === 0) {
            await git.remove({ fs, dir, filepath: file });
          } else {
            await git.add({ fs, dir, filepath: file });
          }
        }
      }
    } else {
      await git.add({ fs, dir, filepath });
    }
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

async function gitConfig(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  if (args.length < 1) {
    return { stdout: "", stderr: "usage: git config <key> [<value>]", exitCode: 1 };
  }

  const path = args[0]!;
  if (args.length === 1) {
    // Get
    try {
      const value = await git.getConfig({ fs, dir, path });
      if (value === undefined) {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: `${value}\n`, stderr: "", exitCode: 0 };
    } catch {
      return { stdout: "", stderr: "", exitCode: 1 };
    }
  }

  // Set
  const value = args[1]!;
  await git.setConfig({ fs, dir, path, value });
  return { stdout: "", stderr: "", exitCode: 0 };
}

async function gitCommit(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const message = getFlag(args, "-m") ?? "";
  if (!message) {
    return { stdout: "", stderr: "Aborting commit due to empty commit message.", exitCode: 1 };
  }

  const authorName = (await git.getConfig({ fs, dir, path: "user.name" })) ?? "Sandbox User";
  const authorEmail = (await git.getConfig({ fs, dir, path: "user.email" })) ?? "sandbox@workspace";

  const sha = await git.commit({ fs, dir, message, author: { name: authorName, email: authorEmail } });

  return { stdout: `[${sha.slice(0, 7)}] ${message}\n`, stderr: "", exitCode: 0 };
}

async function gitStatus(git: IsomorphicGit, fs: FsClient, dir: string): Promise<GitCommandResult> {
  const matrix = await git.statusMatrix({ fs, dir });
  const lines: string[] = [];

  for (const [filepath, head, workdir, stage] of matrix) {
    const status = formatFileStatus(head, workdir, stage);
    if (status) {
      lines.push(`${status} ${filepath}`);
    }
  }

  if (lines.length === 0) {
    return { stdout: "nothing to commit, working tree clean\n", stderr: "", exitCode: 0 };
  }
  return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
}

function formatFileStatus(head: number, workdir: number, stage: number): string | null {
  if (head === 0 && workdir === 2 && stage === 2) return "A "; // new file staged
  if (head === 0 && workdir === 2 && stage === 0) return "??"; // untracked
  if (head === 1 && workdir === 2 && stage === 2) return "M "; // modified staged
  if (head === 1 && workdir === 2 && stage === 1) return " M"; // modified unstaged
  if (head === 1 && workdir === 0 && stage === 0) return "D "; // deleted staged
  if (head === 1 && workdir === 0 && stage === 1) return " D"; // deleted unstaged
  if (head === 1 && workdir === 1 && stage === 1) return null; // unchanged
  if (head === 0 && workdir === 0 && stage === 3) return "A "; // added
  if (head === 1 && workdir === 2 && stage === 3) return "MM"; // modified both
  return " M"; // fallback
}

async function gitLog(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const depthStr = getFlag(args, "-n") ?? getFlag(args, "--max-count");
  const depth = depthStr ? parseInt(depthStr, 10) : 10;

  try {
    const commits = await git.log({ fs, dir, depth: Number.isFinite(depth) ? depth : 10 });
    const lines = commits.map((entry) => {
      const { oid, message, author } = entry.commit ? { oid: entry.oid, ...entry.commit } : (entry as never);
      const date = author?.timestamp ? new Date(author.timestamp * 1000).toISOString() : "";
      return `commit ${oid}\nAuthor: ${author?.name ?? ""} <${author?.email ?? ""}>\nDate:   ${date}\n\n    ${(message ?? "").trim()}\n`;
    });
    return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Could not find")) {
      return { stdout: "", stderr: "fatal: your current branch does not have any commits yet", exitCode: 128 };
    }
    throw error;
  }
}

async function gitDiff(git: IsomorphicGit, fs: FsClient, dir: string): Promise<GitCommandResult> {
  const matrix = await git.statusMatrix({ fs, dir });
  const changed = matrix.filter(([, head, workdir]) => head !== workdir);

  if (changed.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  const lines = changed.map(([filepath, head, workdir]) => {
    if (head === 0) return `new file: ${filepath}`;
    if (workdir === 0) return `deleted: ${filepath}`;
    return `modified: ${filepath}`;
  });

  return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
}

async function gitBranch(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  if (args.length === 0 || args[0] === "--list" || args[0] === "-l") {
    const branches = await git.listBranches({ fs, dir });
    const current = await git.currentBranch({ fs, dir });
    const lines = branches.map((branch) => (branch === current ? `* ${branch}` : `  ${branch}`));
    return { stdout: lines.join("\n") + "\n", stderr: "", exitCode: 0 };
  }

  if (args[0] === "-d" || args[0] === "-D") {
    const branchName = args[1];
    if (!branchName) {
      return { stdout: "", stderr: "fatal: branch name required", exitCode: 1 };
    }
    await git.deleteBranch({ fs, dir, ref: branchName });
    return { stdout: `Deleted branch ${branchName}\n`, stderr: "", exitCode: 0 };
  }

  // Create branch
  const branchName = args[0]!;
  await git.branch({ fs, dir, ref: branchName });
  return { stdout: "", stderr: "", exitCode: 0 };
}

async function gitCheckout(git: IsomorphicGit, fs: FsClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const createBranch = args.includes("-b");
  const ref = createBranch ? getFlag(args, "-b") : args[0];

  if (!ref) {
    return { stdout: "", stderr: "error: no branch or ref specified", exitCode: 1 };
  }

  if (createBranch) {
    await git.branch({ fs, dir, ref });
  }
  await git.checkout({ fs, dir, ref });

  return { stdout: `Switched to branch '${ref}'\n`, stderr: "", exitCode: 0 };
}

// ============================================================================
// Remote subcommands
// ============================================================================

async function gitClone(git: IsomorphicGit, fs: FsClient, http: HttpClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const url = args.find((arg) => arg.startsWith("http://") || arg.startsWith("https://"));
  if (!url) {
    return { stdout: "", stderr: "fatal: repository URL is required (only HTTPS is supported)", exitCode: 128 };
  }

  if (url.startsWith("ssh://") || url.startsWith("git@") || url.startsWith("git://")) {
    return { stdout: "", stderr: "fatal: only public HTTPS repositories are supported", exitCode: 128 };
  }

  // Determine target directory: explicit positional arg, or derive from URL like real git.
  // Must skip flag values (e.g. --depth 1 → "1" is NOT a directory).
  const explicitDir = findPositionalArg(args, url);
  let targetDir: string;
  if (explicitDir) {
    // Resolve relative paths against cwd
    targetDir = explicitDir.startsWith("/") ? explicitDir : `${dir}/${explicitDir}`;
  } else {
    targetDir = `${dir}/${deriveRepoName(url)}`;
  }

  const depthStr = getFlag(args, "--depth");
  const depth = depthStr ? parseInt(depthStr, 10) : undefined;
  const singleBranch = args.includes("--single-branch");

  // Ensure target directory exists
  await fs.promises.mkdir(targetDir, { recursive: true });

  await git.clone({ fs, http, dir: targetDir, url, depth: Number.isFinite(depth) ? depth : undefined, singleBranch });

  return { stdout: `Cloning into '${targetDir}'...\n`, stderr: "", exitCode: 0 };
}

async function gitFetch(git: IsomorphicGit, fs: FsClient, http: HttpClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const remote = args.find((arg) => !arg.startsWith("-")) ?? "origin";

  await git.fetch({ fs, http, dir, remote });

  return { stdout: "", stderr: `From ${remote}\n`, exitCode: 0 };
}

async function gitPull(git: IsomorphicGit, fs: FsClient, http: HttpClient, dir: string, args: string[]): Promise<GitCommandResult> {
  const remote = args.find((arg) => !arg.startsWith("-")) ?? "origin";

  const authorName = (await git.getConfig({ fs, dir, path: "user.name" })) ?? "Sandbox User";
  const authorEmail = (await git.getConfig({ fs, dir, path: "user.email" })) ?? "sandbox@workspace";

  await git.pull({ fs, http, dir, remote, author: { name: authorName, email: authorEmail } });

  return { stdout: "Already up to date.\n", stderr: "", exitCode: 0 };
}

// ============================================================================
// Helpers
// ============================================================================

function getFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

/**
 * Derive a directory name from a git remote URL, mimicking real git behavior:
 * strip trailing `.git`, then take the last path segment.
 */
function deriveRepoName(url: string): string {
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname;
    // Strip trailing slash
    if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    // Strip .git suffix
    if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
    // Take last segment
    const lastSlash = pathname.lastIndexOf("/");
    const name = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    return name || "repo";
  } catch {
    // Fallback: try to extract from the string directly
    const stripped = url.replace(/\.git\/?$/, "").replace(/\/$/, "");
    const lastSlash = stripped.lastIndexOf("/");
    return lastSlash >= 0 ? stripped.slice(lastSlash + 1) || "repo" : "repo";
  }
}

/**
 * Find the first positional argument that is:
 * - not the URL
 * - not a flag (starting with "-")
 * - not a value consumed by a flag (e.g. "1" after "--depth")
 */
function findPositionalArg(args: string[], url: string): string | undefined {
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (CLONE_FLAGS_WITH_VALUE.has(arg)) {
      skipNext = true;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (arg === url) continue;
    return arg;
  }
  return undefined;
}

function formatGitHelp(options: GitCommandOptions): string {
  const lines = [
    "git version 2.0.0-sandbox (isomorphic-git, restricted)",
    "",
    "This is a sandboxed git implementation with limited subcommands.",
    "Only public HTTPS repositories are supported; SSH and push are not available.",
    "Private/loopback addresses are blocked.",
    "",
    "Supported local commands:",
    "  init [-b <branch>]        Initialize a new repository",
    "  add <file|.|-A>           Stage files for commit",
    "  config <key> [<value>]    Get or set config values",
    "  commit -m <message>       Commit staged changes",
    "  status                    Show working tree status",
    "  log [-n <count>]          Show commit log",
    "  diff                      Show changed files summary",
    "  branch [<name>|-d <name>] List, create, or delete branches",
    "  checkout [-b] <ref>       Switch branches",
    "",
  ];

  if (options.network) {
    lines.push(
      "Supported remote commands (network enabled, HTTPS only):",
      "  clone <url> [<dir>] [--depth N] [--single-branch]",
      "  fetch [<remote>]",
      "  pull [<remote>]",
    );
  } else {
    lines.push("Remote commands (clone/fetch/pull): DISABLED — network access is off.");
  }

  lines.push("", "Rejected commands: push (not available in sandbox)");
  lines.push("");
  return lines.join("\n");
}

function truncateResult(result: GitCommandResult): GitCommandResult {
  return {
    stdout: result.stdout.length > MAX_OUTPUT_BYTES ? result.stdout.slice(0, MAX_OUTPUT_BYTES) + "\n[output truncated]" : result.stdout,
    stderr: result.stderr.length > MAX_OUTPUT_BYTES ? result.stderr.slice(0, MAX_OUTPUT_BYTES) + "\n[output truncated]" : result.stderr,
    exitCode: result.exitCode,
  };
}
