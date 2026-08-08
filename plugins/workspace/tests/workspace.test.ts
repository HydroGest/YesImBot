import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Bash } from "just-bash";
import { describe, expect, it } from "vitest";

import { Workspace } from "../src/workspace";

const COMMON_COMMANDS = ["ls", "cat", "echo", "pwd", "mkdir", "rm", "touch", "cp", "mv", "find", "grep", "sort", "head", "tail", "wc"];

async function tmpRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `yesimbot-${name}-`));
}

function lines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

describe("Workspace filesystem", () => {
  it("keeps default command paths available when just-bash uses its internal filesystem", async () => {
    const bash = new Bash();

    const rootListing = await bash.exec("ls /");
    const binListing = await bash.exec("ls /bin");
    const usrBinListing = await bash.exec("ls /usr/bin");
    const path = await bash.exec("echo $PATH");
    const which = await bash.exec(`which ${COMMON_COMMANDS.join(" ")}`);

    expect(rootListing.exitCode).toBe(0);
    expect(lines(rootListing.stdout)).toEqual(expect.arrayContaining(["bin", "usr"]));
    expect(binListing.exitCode).toBe(0);
    expect(lines(binListing.stdout)).toEqual(expect.arrayContaining(COMMON_COMMANDS));
    expect(usrBinListing.exitCode).toBe(0);
    expect(lines(usrBinListing.stdout)).toEqual(expect.arrayContaining(COMMON_COMMANDS));
    expect(lines(path.stdout)[0]?.split(":")).toEqual(expect.arrayContaining(["/usr/bin", "/bin"]));
    expect(which.exitCode).toBe(0);
    for (const command of COMMON_COMMANDS) {
      expect(lines(which.stdout)).toContain(`/usr/bin/${command}`);
    }
  });

  it("persists writes in the default channel workspace", async () => {
    const root = await tmpRoot("workspace-root");
    const workspace = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace" } });

    await workspace.fs.writeFile("/home/workspace/report.txt", "hello", "utf8");

    await expect(readFile(join(root, "report.txt"), "utf8")).resolves.toBe("hello");
  });

  it("mounts read-only paths without allowing writes", async () => {
    const root = await tmpRoot("workspace-root");
    const docs = await tmpRoot("workspace-docs");
    await writeFile(join(docs, "guide.md"), "# Guide\n", "utf8");

    const workspace = await Workspace.create({ root, filesystem: { readOnlyPaths: { "/knowledge": docs } }, bash: { cwd: "/home/workspace" } });

    await expect(workspace.fs.readFile("/knowledge/guide.md", "utf8")).resolves.toBe("# Guide\n");
    await expect(workspace.fs.writeFile("/knowledge/guide.md", "changed", "utf8")).rejects.toThrow(/read-only file system/);
  });

  it("keeps default command paths when custom workspace mounts are configured", async () => {
    const root = await tmpRoot("workspace-root");
    const custom = await tmpRoot("workspace-custom");
    const workspace = await Workspace.create({ root, filesystem: { persistPaths: { "/custom": custom } }, bash: { cwd: "/home/workspace" } });

    const rootListing = await workspace.bash.exec("ls /");
    const binListing = await workspace.bash.exec("ls /bin");
    const usrBinListing = await workspace.bash.exec("ls /usr/bin");
    const usrLocalBinListing = await workspace.bash.exec("ls /usr/local/bin");
    const path = await workspace.bash.exec("echo $PATH");
    const which = await workspace.bash.exec(`which ${COMMON_COMMANDS.join(" ")}`);

    expect(rootListing.exitCode).toBe(0);
    expect(lines(rootListing.stdout)).toEqual(expect.arrayContaining(["bin", "custom", "home", "tmp", "usr"]));
    expect(binListing.exitCode).toBe(0);
    expect(lines(binListing.stdout)).toEqual(expect.arrayContaining(COMMON_COMMANDS));
    expect(usrBinListing.exitCode).toBe(0);
    expect(lines(usrBinListing.stdout)).toEqual(expect.arrayContaining(COMMON_COMMANDS));
    expect(usrLocalBinListing.exitCode).toBe(0);
    expect(lines(path.stdout)[0]?.split(":")).toEqual(expect.arrayContaining(["/usr/local/bin", "/usr/bin", "/bin"]));
    expect(which.exitCode).toBe(0);
    for (const command of COMMON_COMMANDS) {
      expect(lines(which.stdout)).toContain(`/usr/bin/${command}`);
    }
  });

  it("mounts overlay paths as copy-on-write", async () => {
    const root = await tmpRoot("workspace-root");
    const repo = await tmpRoot("workspace-repo");
    await writeFile(join(repo, "package.json"), '{"name":"demo"}\n', "utf8");

    const workspace = await Workspace.create({ root, filesystem: { overlayPaths: { "/repo": repo } }, bash: { cwd: "/repo" } });

    await workspace.fs.writeFile("/repo/package.json", '{"name":"changed"}\n', "utf8");

    await expect(workspace.fs.readFile("/repo/package.json", "utf8")).resolves.toContain("changed");
    await expect(readFile(join(repo, "package.json"), "utf8")).resolves.toContain("demo");
  });

  it("registers python3/js-exec command stubs when enabled", async () => {
    const root = await tmpRoot("workspace-python");
    const workspace = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace", python: true, javascript: true } });
    await workspace.init();

    for (const command of ["python3", "python", "js-exec", "node"]) {
      await expect(workspace.fs.readFile(`/bin/${command}`, "utf8")).resolves.toContain("Built-in command");
      await expect(workspace.fs.readFile(`/usr/bin/${command}`, "utf8")).resolves.toContain("Built-in command");
    }

    const which = await workspace.bash.exec("which python3 js-exec");
    expect(which.exitCode).toBe(0);
    expect(which.stdout).toContain("python3");
    expect(which.stdout).toContain("js-exec");
  });

  it("does not register python3/js-exec stubs when disabled", async () => {
    const root = await tmpRoot("workspace-nopython");
    const workspace = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace" } });
    await workspace.init();

    await expect(workspace.fs.readFile("/bin/python3", "utf8")).rejects.toThrow(/ENOENT/);
    await expect(workspace.fs.readFile("/usr/bin/js-exec", "utf8")).rejects.toThrow(/ENOENT/);
  });
});
