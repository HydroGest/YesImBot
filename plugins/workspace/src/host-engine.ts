import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
const BASH_PATH = "/bin/bash";
const SETPRIV_PATH = "/usr/bin/setpriv";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 30 * 1024;
const DEFAULT_KILL_GRACE_MS = 100;
const TIMEOUT_EXIT_CODE = 124;
const CANCEL_EXIT_CODE = 130;
type TerminationReason = "abort" | "timeout" | "stop";
type QueueEntry = {
  input: HostRunnerInput;
  resolve: (result: HostCommandResult) => void;
  reject: (error: unknown) => void;
  state: "queued" | "active" | "settled";
  onAbort: () => void;
  terminationReason?: TerminationReason;
  terminate?: (reason: TerminationReason) => void;
};
type BoundedBuffer = { append(chunk: Buffer | string): void; toString(): string };
export interface HostCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export interface HostRunnerInput {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  uid: number;
  gid: number;
  signal: AbortSignal;
}
export interface HostRunner {
  run(input: HostRunnerInput): Promise<HostCommandResult>;
  stop(): Promise<void>;
}
export interface HostRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
}
class HostRunnerImpl implements HostRunner {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly killGraceMs: number;
  private readonly children = new Set<ChildProcess>();
  private readonly queue: QueueEntry[] = [];
  private active?: QueueEntry;
  private pumpPromise?: Promise<void>;
  private stopped = false;

  public constructor(options: HostRunnerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Host runner timeoutMs must be positive");
    }
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) {
      throw new Error("Host runner maxOutputBytes must be positive");
    }
    if (!Number.isFinite(this.killGraceMs) || this.killGraceMs < 0) {
      throw new Error("Host runner killGraceMs must not be negative");
    }
  }

  public run(input: HostRunnerInput): Promise<HostCommandResult> {
    try {
      validateInput(input);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.stopped) return Promise.reject(new Error("Host runner is stopped"));
    if (input.signal.aborted) return Promise.resolve(cancellationResult("abort", this.timeoutMs));

    return new Promise<HostCommandResult>((resolve, reject) => {
      const entry: QueueEntry = { input, resolve, reject, state: "queued", onAbort: () => this.cancel(entry, "abort") };
      input.signal.addEventListener("abort", entry.onAbort, { once: true });
      this.queue.push(entry);
      this.startPump();
    });
  }

  public async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      for (const entry of this.queue.splice(0)) {
        this.settle(entry, cancellationResult("stop", this.timeoutMs));
      }
      this.active?.terminate?.("stop");
    }

    const pumpPromise = this.pumpPromise;
    if (pumpPromise) await pumpPromise;
  }

  private startPump(): void {
    if (this.pumpPromise) return;
    this.pumpPromise = this.drainQueue().finally(() => {
      this.pumpPromise = undefined;
      if (!this.stopped && this.queue.length > 0) this.startPump();
    });
  }

  private async drainQueue(): Promise<void> {
    while (!this.stopped) {
      const entry = this.queue.shift();
      if (!entry) return;
      if (entry.state !== "queued") continue;

      entry.state = "active";
      this.active = entry;
      try {
        this.settle(entry, await this.execute(entry));
      } catch (error) {
        this.settleError(entry, error);
      } finally {
        this.active = undefined;
      }
    }
  }

  private cancel(entry: QueueEntry, reason: TerminationReason): void {
    if (entry.state === "settled") return;
    entry.terminationReason ??= reason;
    if (entry.state === "queued") {
      const index = this.queue.indexOf(entry);
      if (index >= 0) this.queue.splice(index, 1);
      this.settle(entry, cancellationResult(reason, this.timeoutMs));
      return;
    }
    entry.terminate?.(reason);
  }

  private settle(entry: QueueEntry, result: HostCommandResult): void {
    if (entry.state === "settled") return;
    entry.state = "settled";
    entry.input.signal.removeEventListener("abort", entry.onAbort);
    entry.resolve(result);
  }

  private settleError(entry: QueueEntry, error: unknown): void {
    if (entry.state === "settled") return;
    entry.state = "settled";
    entry.input.signal.removeEventListener("abort", entry.onAbort);
    entry.reject(error);
  }

  private async execute(entry: QueueEntry): Promise<HostCommandResult> {
    if (entry.terminationReason) return cancellationResult(entry.terminationReason, this.timeoutMs);
    const useSetpriv = await hasSetpriv();
    if (entry.terminationReason) return cancellationResult(entry.terminationReason, this.timeoutMs);

    const args = ["--noprofile", "--norc", "-c", entry.input.command];
    const executable = useSetpriv ? SETPRIV_PATH : BASH_PATH;
    const executableArgs = useSetpriv
      ? ["--clear-groups", "--reuid", String(entry.input.uid), "--regid", String(entry.input.gid), "--", BASH_PATH, ...args]
      : args;
    const spawnOptions: SpawnOptions = {
      cwd: entry.input.cwd,
      env: entry.input.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (!useSetpriv) {
      spawnOptions.uid = entry.input.uid;
      spawnOptions.gid = entry.input.gid;
    }

    return await new Promise<HostCommandResult>((resolve, reject) => {
      const stdout = createBoundedBuffer(this.maxOutputBytes);
      const stderr = createBoundedBuffer(this.maxOutputBytes);
      const child = spawn(executable, executableArgs, spawnOptions);
      this.children.add(child);
      let settled = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;

      const clearTimers = (): void => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = undefined;
        }
      };
      const finish = (result: HostCommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        entry.terminate = undefined;
        this.children.delete(child);
        resolve(result);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        entry.terminate = undefined;
        this.children.delete(child);
        reject(error);
      };
      const terminate = (reason: TerminationReason): void => {
        if (settled) return;
        entry.terminationReason ??= reason;
        this.signalProcessGroup(child, "SIGTERM");
        if (!graceTimer) {
          graceTimer = setTimeout(() => {
            if (!settled) this.signalProcessGroup(child, "SIGKILL");
          }, this.killGraceMs);
          graceTimer.unref();
        }
      };
      entry.terminate = terminate;

      child.stdout?.on("data", (chunk: Buffer | string) => stdout.append(chunk));
      child.stderr?.on("data", (chunk: Buffer | string) => stderr.append(chunk));
      child.once("error", fail);
      child.once("close", (code) => {
        const reason = entry.terminationReason;
        const result: HostCommandResult = {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: reason === "timeout" ? TIMEOUT_EXIT_CODE : reason ? CANCEL_EXIT_CODE : (code ?? 1),
        };
        if (reason) {
          const message = cancellationResult(reason, this.timeoutMs).stderr;
          result.stderr = result.stderr.length > 0 ? `${result.stderr}\n${message}` : message;
        }
        finish(result);
      });

      if (entry.terminationReason) {
        terminate(entry.terminationReason);
      } else {
        timeoutTimer = setTimeout(() => terminate("timeout"), this.timeoutMs);
        timeoutTimer.unref();
      }
    });
  }

  private signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== "win32" && child.pid !== undefined && child.pid !== null) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          // Fall through to the direct child kill when group signalling is unavailable.
        } else {
          return;
        }
      }
    }
    try {
      child.kill(signal);
    } catch {
      // The process may have exited between close checks and signalling.
    }
  }
}
function createBoundedBuffer(maxBytes: number): BoundedBuffer {
  const chunks: Buffer[] = [];
  let size = 0;

  return {
    append(chunk) {
      if (size >= maxBytes) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - size;
      chunks.push(bytes.length <= remaining ? bytes : bytes.subarray(0, remaining));
      size += Math.min(bytes.length, remaining);
    },
    toString() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
function cancellationResult(reason: TerminationReason, timeoutMs: number): HostCommandResult {
  return {
    stdout: "",
    stderr: reason === "timeout" ? `Command timed out after ${timeoutMs}ms` : "Command cancelled",
    exitCode: reason === "timeout" ? TIMEOUT_EXIT_CODE : CANCEL_EXIT_CODE,
  };
}
function validateInput(input: HostRunnerInput): void {
  if (process.platform === "win32") {
    throw new Error("Host runner requires Unix process-group support");
  }
  if (typeof input.command !== "string") {
    throw new Error("Host runner command must be a string");
  }
  if (typeof input.cwd !== "string" || input.cwd.length === 0) {
    throw new Error("Host runner cwd is required");
  }
  if (!Number.isSafeInteger(input.uid) || input.uid < 0) {
    throw new Error("Host runner requires a numeric uid");
  }
  if (!Number.isSafeInteger(input.gid) || input.gid < 0) {
    throw new Error("Host runner requires a numeric gid");
  }
}
async function hasSetpriv(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    await access(SETPRIV_PATH, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export function createHostRunner(options: HostRunnerOptions = {}): HostRunner {
  return new HostRunnerImpl(options);
}
