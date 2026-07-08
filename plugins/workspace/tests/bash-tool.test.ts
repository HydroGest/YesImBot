import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createBashToolSet } from "../src/bash-tool";
import { Workspace } from "../src/workspace";

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "yesimbot-bash-tool-"));
  return new Workspace({
    root,
    filesystem: {},
    bash: { cwd: "/home/workspace", timeoutMs: 1000 },
  });
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
    const exec = vi
      .spyOn(workspace.bash, "exec")
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
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
});
