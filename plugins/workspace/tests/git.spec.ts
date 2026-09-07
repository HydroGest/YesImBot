import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createGitCommand, isPrivateHost } from "../src/git";
import { Workspace } from "../src/workspace";

async function tmpRoot(name: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `yesimbot-git-${name}-`));
}

async function createGitWorkspace(options?: { network?: boolean }) {
  const root = await tmpRoot("workspace");
  const workspace = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace" }, git: options?.network ? { network: {} } : undefined });
  return workspace;
}

describe("git local operations", () => {
  it("initializes a git repository", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["init"], { cwd: "/home/workspace" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialized empty Git repository");

    // .git directory should exist
    const stat = await workspace.fs.stat("/home/workspace/.git");
    expect(stat.isDirectory).toBe(true);
  });

  it("initializes with custom default branch name", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init", "-b", "develop"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "t@t.com"], { cwd: "/home/workspace" });
    await workspace.fs.writeFile("/home/workspace/f.txt", "x", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "init"], { cwd: "/home/workspace" });

    const result = await git(["branch"], { cwd: "/home/workspace" });
    expect(result.stdout).toContain("develop");
  });

  it("adds files and commits", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test User"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "test@example.com"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/hello.txt", "Hello World\n", "utf8");
    await git(["add", "hello.txt"], { cwd: "/home/workspace" });
    const commitResult = await git(["commit", "-m", "initial commit"], { cwd: "/home/workspace" });

    expect(commitResult.exitCode).toBe(0);
    expect(commitResult.stdout).toContain("initial commit");
  });

  it("shows status of untracked and staged files", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/file1.txt", "content\n", "utf8");
    const statusBefore = await git(["status"], { cwd: "/home/workspace" });
    expect(statusBefore.stdout).toContain("??");
    expect(statusBefore.stdout).toContain("file1.txt");

    await git(["add", "file1.txt"], { cwd: "/home/workspace" });
    const statusAfter = await git(["status"], { cwd: "/home/workspace" });
    expect(statusAfter.stdout).toContain("A ");
    expect(statusAfter.stdout).toContain("file1.txt");
  });

  it("shows log of commits", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test User"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "test@example.com"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/a.txt", "a", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "first"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/b.txt", "b", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "second"], { cwd: "/home/workspace" });

    const logResult = await git(["log"], { cwd: "/home/workspace" });
    expect(logResult.exitCode).toBe(0);
    expect(logResult.stdout).toContain("first");
    expect(logResult.stdout).toContain("second");
    expect(logResult.stdout).toContain("Test User");
  });

  it("shows diff of modified files", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "t@t.com"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/file.txt", "original content here", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "base"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/file.txt", "modified", "utf8");
    const diffResult = await git(["diff"], { cwd: "/home/workspace" });
    expect(diffResult.exitCode).toBe(0);
    expect(diffResult.stdout).toContain("modified: file.txt");
  });

  it("creates and lists branches", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "t@t.com"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/f.txt", "x", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "init"], { cwd: "/home/workspace" });

    await git(["branch", "feature"], { cwd: "/home/workspace" });
    const branchResult = await git(["branch"], { cwd: "/home/workspace" });
    expect(branchResult.stdout).toContain("main");
    expect(branchResult.stdout).toContain("feature");
    expect(branchResult.stdout).toContain("*");
  });

  it("checks out a branch", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "t@t.com"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/f.txt", "x", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "init"], { cwd: "/home/workspace" });

    const result = await git(["checkout", "-b", "dev"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dev");
  });

  it("gets and sets config", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });

    await git(["config", "user.name", "Alice"], { cwd: "/home/workspace" });
    const getResult = await git(["config", "user.name"], { cwd: "/home/workspace" });
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout.trim()).toBe("Alice");
  });

  it("reports error for empty commit message", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    await git(["init"], { cwd: "/home/workspace" });

    await workspace.fs.writeFile("/home/workspace/f.txt", "x", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    const result = await git(["commit", "-m", ""], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("empty commit message");
  });

  it("rejects unsupported subcommands", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["rebase"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unsupported");
  });

  it("rejects push explicitly", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["push"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not supported");
  });

  it("reports usage for empty args", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git([], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("sandbox");
  });

  it("shows version with --version", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["--version"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sandbox");
    expect(result.stdout).toContain("isomorphic-git");
  });

  it("shows help with --help", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["--help"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Supported local commands");
    expect(result.stdout).toContain("Rejected commands");
    expect(result.stdout).toContain("Remote commands");
  });

  it("shows help with help subcommand", async () => {
    const workspace = await createGitWorkspace();
    const git = createGitCommand(workspace.fs);
    const result = await git(["help"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Supported local commands");
  });

  it("shows remote commands in help when network is enabled", async () => {
    const workspace = await createGitWorkspace({ network: true });
    const git = createGitCommand(workspace.fs, { network: {} });
    const result = await git(["--help"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Supported remote commands");
    expect(result.stdout).toContain("clone");
  });
});

describe("git remote operations", () => {
  it("rejects clone when network is disabled", async () => {
    const workspace = await createGitWorkspace({ network: false });
    const git = createGitCommand(workspace.fs);
    const result = await git(["clone", "https://github.com/example/repo.git"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("network access is disabled");
  });

  it("rejects clone to private address", async () => {
    const workspace = await createGitWorkspace({ network: true });
    const git = createGitCommand(workspace.fs, { network: {} });
    const result = await git(["clone", "https://localhost/repo.git"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("private address");
  });

  it("does not treat --depth value as target directory", async () => {
    // Use a private address so it fails fast without network timeout
    const workspace = await createGitWorkspace({ network: true });
    const git = createGitCommand(workspace.fs, { network: {} });
    const result = await git(["clone", "--depth", "1", "https://127.0.0.1/example/repo.git"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("private address");
    // The output should NOT contain '/1' as a target directory
    expect(result.stdout).not.toContain("'/1'");
  });

  it("rejects clone to 10.x private range", async () => {
    const workspace = await createGitWorkspace({ network: true });
    const git = createGitCommand(workspace.fs, { network: {} });
    const result = await git(["clone", "https://10.0.0.1/repo.git"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain("private address");
  });

  it("rejects fetch when network is disabled", async () => {
    const workspace = await createGitWorkspace({ network: false });
    const git = createGitCommand(workspace.fs);
    const result = await git(["fetch"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("network access is disabled");
  });

  it("rejects pull when network is disabled", async () => {
    const workspace = await createGitWorkspace({ network: false });
    const git = createGitCommand(workspace.fs);
    const result = await git(["pull"], { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("network access is disabled");
  });
});

describe("git via bash custom command", () => {
  it("runs git init through the bash interface", async () => {
    const workspace = await createGitWorkspace();
    await workspace.init();

    const result = await workspace.bash.exec("git init", { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialized empty Git repository");
  });

  it("runs git status through the bash interface", async () => {
    const workspace = await createGitWorkspace();
    await workspace.init();

    await workspace.bash.exec("git init", { cwd: "/home/workspace" });
    await workspace.fs.writeFile("/home/workspace/test.txt", "test", "utf8");
    const result = await workspace.bash.exec("git status", { cwd: "/home/workspace" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test.txt");
  });

  it("runs full git workflow through bash", async () => {
    const workspace = await createGitWorkspace();
    await workspace.init();

    await workspace.bash.exec("git init", { cwd: "/home/workspace" });
    await workspace.bash.exec('git config user.name "Test"', { cwd: "/home/workspace" });
    await workspace.bash.exec('git config user.email "t@t.com"', { cwd: "/home/workspace" });
    await workspace.fs.writeFile("/home/workspace/readme.md", "# Hello", "utf8");
    await workspace.bash.exec("git add .", { cwd: "/home/workspace" });
    const commitResult = await workspace.bash.exec('git commit -m "init"', { cwd: "/home/workspace" });

    expect(commitResult.exitCode).toBe(0);
    expect(commitResult.stdout).toContain("init");

    const logResult = await workspace.bash.exec("git log", { cwd: "/home/workspace" });
    expect(logResult.exitCode).toBe(0);
    expect(logResult.stdout).toContain("init");
  });
});

describe("git mount persistence", () => {
  it("persists git repos to the workspace mount", async () => {
    const root = await tmpRoot("persist");
    const workspace = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace" } });
    const git = createGitCommand(workspace.fs);

    await git(["init"], { cwd: "/home/workspace" });
    await git(["config", "user.name", "Test"], { cwd: "/home/workspace" });
    await git(["config", "user.email", "t@t.com"], { cwd: "/home/workspace" });
    await workspace.fs.writeFile("/home/workspace/file.txt", "persisted", "utf8");
    await git(["add", "."], { cwd: "/home/workspace" });
    await git(["commit", "-m", "persist"], { cwd: "/home/workspace" });

    // Create a second workspace with the same root — should see the repo
    const workspace2 = await Workspace.create({ root, filesystem: {}, bash: { cwd: "/home/workspace" } });
    const git2 = createGitCommand(workspace2.fs);
    const logResult = await git2(["log"], { cwd: "/home/workspace" });
    expect(logResult.exitCode).toBe(0);
    expect(logResult.stdout).toContain("persist");
  });
});

describe("isPrivateHost", () => {
  it("detects localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("detects private ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
  });

  it("detects .local suffix", () => {
    expect(isPrivateHost("myhost.local")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(isPrivateHost("github.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });
});
