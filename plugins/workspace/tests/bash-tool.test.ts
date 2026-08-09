import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createBashToolSet } from "../src/bash-tool";
import { Workspace } from "../src/workspace";

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-bash-tool-"));
  return Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace", timeoutMs: 1000 } });
}
type BackendCall = { command: string; options?: { cwd?: string; signal?: AbortSignal } };

function createFakeBackend(output = { stdout: "out", stderr: "err", exitCode: 7 }) {
  const calls: BackendCall[] = [];
  const reads: string[] = [];
  const writes: Array<readonly { path: string; content: string }[]> = [];
  const files = new Map<string, string>();

  return {
    calls,
    reads,
    writes,
    backend: {
      async executeCommand(command: string, options?: BackendCall["options"]) {
        calls.push({ command, options });
        return output;
      },
      async readFile(path: string) {
        reads.push(path);
        return files.get(path) ?? "";
      },
      async writeFiles(nextFiles: readonly { path: string; content: string }[]) {
        writes.push(nextFiles);
        for (const file of nextFiles) files.set(file.path, file.content);
      },
    },
  };
}

function toolByName(tools: Awaited<ReturnType<typeof createBashToolSet>>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe("bash-tool adapter", () => {
  it("returns named AgentTools from bash-tool", async () => {
    const workspace = await createWorkspace();
    const tools = await createBashToolSet(workspace);

    expect(tools.map((tool) => tool.name).sort()).toEqual(["bash", "readFile", "writeFile"]);
  });

  it("reads and writes through the same virtual filesystem used by bash", async () => {
    const workspace = await createWorkspace();
    const tools = await createBashToolSet(workspace);
    const writeFile = tools.find((tool) => tool.name === "writeFile");
    const readFile = tools.find((tool) => tool.name === "readFile");
    const bash = tools.find((tool) => tool.name === "bash");

    expect(writeFile?.execute).toBeTypeOf("function");
    expect(readFile?.execute).toBeTypeOf("function");
    expect(bash?.execute).toBeTypeOf("function");

    await writeFile!.execute!({ path: "note.txt", content: "hello\n" }, {} as never);
    const readResult = await readFile!.execute!({ path: "note.txt" }, {} as never);
    const bashResult = await bash!.execute!({ command: "cat note.txt" }, {} as never);

    expect(readResult).toEqual({ content: "hello\n" });
    expect(bashResult).toMatchObject({ stdout: "hello\n", exitCode: 0 });
  });

  it("combines the agent abort signal with the command timeout signal", async () => {
    const workspace = await createWorkspace();
    const exec = vi.spyOn(workspace.bash, "exec").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const tools = await createBashToolSet(workspace);
    const bash = tools.find((tool) => tool.name === "bash");
    const abortController = new AbortController();

    expect(bash?.execute).toBeTypeOf("function");
    exec.mockClear();

    await bash!.execute!({ command: "pwd" }, { abortSignal: abortController.signal } as never);

    const signal = exec.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(abortController.signal);

    abortController.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signal?.aborted).toBe(true);
  });

  it("passes structured cwd and abort data through the backend", async () => {
    const output = { stdout: "o".repeat(30_001), stderr: "e".repeat(30_001), exitCode: 0 };
    const sandbox = createFakeBackend(output);
    const sandboxTools = await createBashToolSet({ backend: sandbox.backend, destination: "/sandbox/workspace" });
    sandbox.calls.length = 0;
    const sandboxAbort = new AbortController();

    const sandboxResult = await toolByName(sandboxTools, "bash").execute!({ command: "printf sandbox" }, { abortSignal: sandboxAbort.signal } as never);

    expect(sandboxResult).toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("[stdout truncated: 1 characters removed]"),
      stderr: expect.stringContaining("[stderr truncated: 1 characters removed]"),
    });
    expect(sandbox.calls).toEqual([{ command: "printf sandbox", options: { cwd: "/sandbox/workspace", signal: sandboxAbort.signal } }]);

    sandboxAbort.abort();
    expect(sandbox.calls[0]?.options?.signal?.aborted).toBe(true);
  });

  it("reads and writes through a custom backend", async () => {
    const sandbox = createFakeBackend();
    const tools = await createBashToolSet({ backend: sandbox.backend, destination: "/sandbox/workspace" });

    const writeResult = await toolByName(tools, "writeFile").execute!({ path: "note.txt", content: "sandbox" }, {} as never);
    expect(writeResult).toEqual({ success: true });
    await expect(toolByName(tools, "readFile").execute!({ path: "note.txt" }, {} as never)).resolves.toEqual({ content: "sandbox" });
  });
});
