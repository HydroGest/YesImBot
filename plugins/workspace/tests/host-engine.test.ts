import { access } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHostRunner, type HostRunner, type HostRunnerInput } from "../src/host-engine";

const uid = process.getuid?.();
const gid = process.getgid?.();
const hostDescribe = process.platform !== "win32" && uid !== undefined && gid !== undefined ? describe : describe.skip;

const runners: HostRunner[] = [];
const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "yesimbot-host-engine-"));
  directories.push(directory);
  return directory;
}

function newRunner(options: Parameters<typeof createHostRunner>[0] = {}): HostRunner {
  const runner = createHostRunner(options);
  runners.push(runner);
  return runner;
}

function input(
  cwd: string,
  command: string,
  signal: AbortSignal = new AbortController().signal,
  environment: NodeJS.ProcessEnv = {},
): HostRunnerInput {
  return {
    command,
    cwd,
    env: { ...process.env, ...environment },
    uid: uid!,
    gid: gid!,
    signal,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

afterEach(async () => {
  for (const runner of runners.splice(0)) await runner.stop();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

hostDescribe("HostRunner", () => {
  it("runs real Bash with the requested cwd, environment, identity, and exit result", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 2_000 });

    const result = await runner.run(
      input(cwd, `printf '%s|%s|%s|%s' "$PWD" "$HOST_RUNNER_ENV" "$(id -u)" "$(id -g)"`, undefined, {
        HOST_RUNNER_ENV: "inherited-through-runner",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${cwd}|inherited-through-runner|${uid}|${gid}`);
    expect(result.stderr).toBe("");
  });

  it("preserves stdout, stderr, and nonzero exit codes", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 2_000 });

    const result = await runner.run(input(cwd, "printf out; printf err >&2; exit 7"));

    expect(result).toEqual({ stdout: "out", stderr: "err", exitCode: 7 });
  });

  it("bounds each output stream while draining the child", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ maxOutputBytes: 1024, timeoutMs: 2_000 });

    const result = await runner.run(input(cwd, "head -c 100000 /dev/zero | tr '\\0' x"));

    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBe(1024);
    expect(Buffer.byteLength(result.stderr)).toBe(0);
  });

  it("terminates the complete process group on timeout and maps it to exit 124", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 75, killGraceMs: 25 });
    const started = Date.now();

    const result = await runner.run(input(cwd, "trap '' TERM; sleep 10"));

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("Command timed out after 75ms");
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(runner.run(input(cwd, "printf recovered"))).resolves.toMatchObject({
      stdout: "recovered",
      exitCode: 0,
    });
  });

  it("terminates an aborted process and releases the global slot", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 5_000, killGraceMs: 25 });
    const controller = new AbortController();
    const running = runner.run(input(cwd, "trap '' TERM; sleep 10", controller.signal));
    await delay(50);

    controller.abort();
    await expect(running).resolves.toMatchObject({ exitCode: 130, stderr: "Command cancelled" });
    await expect(runner.run(input(cwd, "printf recovered"))).resolves.toMatchObject({
      stdout: "recovered",
      exitCode: 0,
    });
  });

  it("serializes concurrent calls through one process slot", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 2_000 });

    const first = runner.run(input(cwd, "sleep 0.15; printf first"));
    const second = runner.run(input(cwd, "printf second"));

    await expect(first).resolves.toMatchObject({ stdout: "first", exitCode: 0 });
    await expect(second).resolves.toMatchObject({ stdout: "second", exitCode: 0 });
  });

  it("cancels queued work and stops active process groups", async () => {
    const cwd = await temporaryDirectory();
    const marker = join(cwd, "late-marker");
    const runner = newRunner({ timeoutMs: 5_000, killGraceMs: 25 });
    const active = runner.run(input(cwd, `trap '' TERM; (sleep 0.4; touch '${marker}') & wait`));
    await delay(50);
    const queuedController = new AbortController();
    const queued = runner.run(input(cwd, "printf never", queuedController.signal));

    queuedController.abort();
    await expect(queued).resolves.toMatchObject({ exitCode: 130, stderr: "Command cancelled" });
    await runner.stop();
    await expect(active).resolves.toMatchObject({
      exitCode: 130,
      stderr: expect.stringContaining("Command cancelled"),
    });
    await delay(500);
    expect(await exists(marker)).toBe(false);
    await expect(runner.run(input(cwd, "printf stopped"))).rejects.toThrow("Host runner is stopped");
  });

  it("rejects unusable identities instead of falling back to the current process", async () => {
    const cwd = await temporaryDirectory();
    const runner = newRunner({ timeoutMs: 2_000 });

    await expect(runner.run({ ...input(cwd, "printf unsafe"), uid: Number.NaN })).rejects.toThrow(/numeric uid/);
    await expect(runner.run({ ...input(cwd, "printf unsafe"), gid: Number.NaN })).rejects.toThrow(/numeric gid/);
  });
});
