# Workspace Just-Bash Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the workspace plugin's custom tool layer with `bash-tool`, make default workspaces channel-scoped, and document safe mount patterns for Koishi operators.

**Architecture:** `just-bash` remains the sandbox and virtual filesystem engine. `koishi-plugin-yesimbot-workspace` owns Koishi config, channel-scoped workspace lifecycle, mount validation, prompt policy, and documentation; `bash-tool` owns the default agent tools (`bash`, `readFile`, `writeFile`). Workspaces are created lazily per `platform:selfId:channelId` and backed by a persistent `/home/workspace` mount under the configured plugin root.

**Tech Stack:** TypeScript, Koishi `Schema`, `@yesimbot/agent-runtime`, `just-bash`, `bash-tool`, Vitest, Yarn 4, OpenSpec `superpowers-bridge`.

## Global Constraints

- Communication with users is Chinese; code, identifiers, logs, and error strings remain in English.
- Use `yarn`, not `npm` or `pnpm`.
- Prefix shell verification commands with `rtk`.
- Keep edits scoped to `plugins/workspace` and this OpenSpec change unless a failing check proves shared code must change.
- Do not add new dependencies; `bash-tool`, `@vercel/sandbox`, and `just-bash` are already present in `plugins/workspace/package.json`.
- Do not implement a full `@vercel/sandbox` backend in this change.
- Do not bypass the `just-bash` virtual filesystem for agent file tools.
- Default workspace scope is channel-isolated.
- Do not provide legacy custom tool aliases in the first implementation; document the default tool-name change instead.

---

## File Map

- Modify `plugins/workspace/src/types.ts`: add `overlayPaths`, mount summary types, and any small config-facing types.
- Modify `plugins/workspace/src/workspace.ts`: build persistent default workspace with `ReadWriteFs`; add overlay mount support; expose mount summary data.
- Create `plugins/workspace/src/mounts.ts`: normalize virtual mount paths, reject invalid/conflicting mounts, create sanitized channel workspace IDs.
- Create `plugins/workspace/src/bash-tool.ts`: adapt `Workspace` to `bash-tool`'s `Sandbox` interface and convert returned AI SDK tools into named `AgentTool`s.
- Create `plugins/workspace/src/prompt.ts`: format channel-aware workspace system prompt.
- Modify `plugins/workspace/src/index.ts`: register channel-scoped workspaces and `bash-tool` tools; add `readOnlyPaths` and `overlayPaths` config schema.
- Delete `plugins/workspace/src/tools/*.ts` only after replacement tests pass; these custom tools are no longer the default implementation.
- Add `plugins/workspace/tests/mounts.test.ts`: mount validation and channel ID tests.
- Add `plugins/workspace/tests/bash-tool.test.ts`: `bash-tool` adapter tests using a real `Workspace`.
- Add `plugins/workspace/tests/plugin.test.ts`: Koishi-style plugin registration, channel isolation, default tools, and prompt tests.
- Remove or rewrite old custom-tool tests under `plugins/workspace/tests/*-file.test.ts`, `grep.test.ts`, `glob.test.ts`, `execute-command.test.ts`, and `helpers.test.ts` after the old custom tools are removed.
- Create or update `plugins/workspace/README.md`: operator-facing usage, config, examples, and security notes.
- Update `plugins/workspace/docs/just-bash.md` only if it is intended to remain local package documentation; otherwise keep examples in README.

---

## Task 1: Mount Validation And Channel Workspace Paths

**Files:**
- Create: `plugins/workspace/src/mounts.ts`
- Test: `plugins/workspace/tests/mounts.test.ts`

**Interfaces:**
- Produces: `normalizeVirtualMountPath(path: string): string`
- Produces: `assertValidMountConfig(config: WorkspaceMountConfig): NormalizedWorkspaceMountConfig`
- Produces: `createChannelWorkspaceId(target: WorkspaceChannelTarget): string`
- Consumes later: `Workspace` and `WorkspacePlugin` call these before filesystem construction.

- [ ] **Step 1: Write failing mount utility tests**

Create `plugins/workspace/tests/mounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  assertValidMountConfig,
  createChannelWorkspaceId,
  normalizeVirtualMountPath,
} from "../src/mounts";

describe("workspace mount validation", () => {
  it("normalizes simple absolute virtual paths", () => {
    expect(normalizeVirtualMountPath("/knowledge/")).toBe("/knowledge");
  });

  it("rejects relative virtual paths", () => {
    expect(() => normalizeVirtualMountPath("knowledge")).toThrow(/absolute virtual path/);
  });

  it("rejects dot and dot-dot segments", () => {
    expect(() => normalizeVirtualMountPath("/data/../secret")).toThrow(/must not contain/);
    expect(() => normalizeVirtualMountPath("/data/./files")).toThrow(/must not contain/);
  });

  it("rejects duplicate mount points across maps", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/data": "/host/a" },
        readOnlyPaths: { "/data": "/host/b" },
      }),
    ).toThrow(/Duplicate mount point/);
  });

  it("rejects nested mount points", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/data": "/host/a" },
        overlayPaths: { "/data/repo": "/host/b" },
      }),
    ).toThrow(/Nested mount point/);
  });

  it("rejects explicit mounts over the default workspace", () => {
    expect(() =>
      assertValidMountConfig({
        persistPaths: { "/home/workspace": "/host/workspace" },
      }),
    ).toThrow(/reserved mount point/);
  });

  it("creates stable readable channel workspace ids", () => {
    const idA = createChannelWorkspaceId({
      platform: "onebot",
      selfId: "bot:1000",
      channelId: "group/2000",
    });
    const idB = createChannelWorkspaceId({
      platform: "onebot",
      selfId: "bot:1000",
      channelId: "group/2001",
    });

    expect(idA).toMatch(/^onebot_bot_1000_group_2000-[a-f0-9]{12}$/);
    expect(idA).not.toBe(idB);
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/mounts.test.ts
```

Expected: FAIL because `../src/mounts` does not exist.

- [ ] **Step 3: Implement mount utilities**

Create `plugins/workspace/src/mounts.ts`:

```ts
import { createHash } from "node:crypto";
import { posix } from "node:path";

export const DEFAULT_WORKSPACE_MOUNT = "/home/workspace";

export interface WorkspaceChannelTarget {
  platform: string;
  selfId: string;
  channelId: string;
}

export interface WorkspaceMountConfig {
  persistPaths?: Record<string, string>;
  readOnlyPaths?: Record<string, string>;
  overlayPaths?: Record<string, string>;
}

export interface NormalizedWorkspaceMountConfig {
  persistPaths: Record<string, string>;
  readOnlyPaths: Record<string, string>;
  overlayPaths: Record<string, string>;
}

export function normalizeVirtualMountPath(path: string): string {
  if (!path || path.trim().length === 0) {
    throw new Error("Mount point must not be empty");
  }
  if (!path.startsWith("/")) {
    throw new Error(`Mount point must be an absolute virtual path: ${path}`);
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Mount point must not contain . or .. segments: ${path}`);
  }

  const normalized = posix.normalize(path).replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    throw new Error("Mount point / is not allowed");
  }
  return normalized;
}

function normalizeMap(paths: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [mountPoint, hostPath] of Object.entries(paths ?? {})) {
    const normalizedMount = normalizeVirtualMountPath(mountPoint);
    if (normalizedMount === DEFAULT_WORKSPACE_MOUNT) {
      throw new Error(`${normalizedMount} is a reserved mount point`);
    }
    normalized[normalizedMount] = hostPath;
  }
  return normalized;
}

export function assertValidMountConfig(config: WorkspaceMountConfig): NormalizedWorkspaceMountConfig {
  const normalized: NormalizedWorkspaceMountConfig = {
    persistPaths: normalizeMap(config.persistPaths),
    readOnlyPaths: normalizeMap(config.readOnlyPaths),
    overlayPaths: normalizeMap(config.overlayPaths),
  };

  const seen = new Map<string, string>();
  for (const [kind, paths] of Object.entries(normalized)) {
    for (const mountPoint of Object.keys(paths)) {
      const previous = seen.get(mountPoint);
      if (previous) {
        throw new Error(`Duplicate mount point ${mountPoint} in ${previous} and ${kind}`);
      }
      seen.set(mountPoint, kind);
    }
  }

  const mountPoints = [...seen.keys()].sort();
  for (let i = 0; i < mountPoints.length; i += 1) {
    for (let j = i + 1; j < mountPoints.length; j += 1) {
      const parent = mountPoints[i];
      const child = mountPoints[j];
      if (child.startsWith(`${parent}/`)) {
        throw new Error(`Nested mount point ${child} is not allowed under ${parent}`);
      }
    }
  }

  return normalized;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function createChannelWorkspaceId(target: WorkspaceChannelTarget): string {
  const raw = `${target.platform}:${target.selfId}:${target.channelId}`;
  const readable =
    [target.platform, target.selfId, target.channelId].map(sanitizeSegment).filter(Boolean).join("_") ||
    "channel";
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${readable.slice(0, 96)}-${digest}`;
}
```

- [ ] **Step 4: Run mount tests and confirm they pass**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/mounts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add plugins/workspace/src/mounts.ts plugins/workspace/tests/mounts.test.ts
git commit -m "feat(workspace): validate virtual mounts"
```

---

## Task 2: Workspace Filesystem Construction

**Files:**
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Test: extend `plugins/workspace/tests/mounts.test.ts` or create `plugins/workspace/tests/workspace.test.ts`

**Interfaces:**
- Consumes: `assertValidMountConfig()` and `DEFAULT_WORKSPACE_MOUNT` from Task 1.
- Produces: `Workspace.mounts` summary for prompt formatting.
- Produces: `Workspace.defaultTimeoutMs` unchanged for the `bash-tool` adapter.

- [ ] **Step 1: Write failing workspace filesystem tests**

Create `plugins/workspace/tests/workspace.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { Workspace } from "../src/workspace";

async function tmpRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `yesimbot-${name}-`));
}

describe("Workspace filesystem", () => {
  it("persists writes in the default channel workspace", async () => {
    const root = await tmpRoot("workspace-root");
    const workspace = new Workspace({
      root,
      filesystem: {},
      bash: { cwd: "/home/workspace" },
    });

    await workspace.fs.writeFile("/home/workspace/report.txt", "hello", "utf8");

    await expect(readFile(join(root, "report.txt"), "utf8")).resolves.toBe("hello");
  });

  it("mounts read-only paths without allowing writes", async () => {
    const root = await tmpRoot("workspace-root");
    const docs = await tmpRoot("workspace-docs");
    await writeFile(join(docs, "guide.md"), "# Guide\n", "utf8");

    const workspace = new Workspace({
      root,
      filesystem: { readOnlyPaths: { "/knowledge": docs } },
      bash: { cwd: "/home/workspace" },
    });

    await expect(workspace.fs.readFile("/knowledge/guide.md", "utf8")).resolves.toBe("# Guide\n");
    await expect(workspace.fs.writeFile("/knowledge/guide.md", "changed", "utf8")).rejects.toThrow();
  });

  it("mounts overlay paths as copy-on-write", async () => {
    const root = await tmpRoot("workspace-root");
    const repo = await tmpRoot("workspace-repo");
    await writeFile(join(repo, "package.json"), "{\"name\":\"demo\"}\n", "utf8");

    const workspace = new Workspace({
      root,
      filesystem: { overlayPaths: { "/repo": repo } },
      bash: { cwd: "/repo" },
    });

    await workspace.fs.writeFile("/repo/package.json", "{\"name\":\"changed\"}\n", "utf8");

    await expect(workspace.fs.readFile("/repo/package.json", "utf8")).resolves.toContain("changed");
    await expect(readFile(join(repo, "package.json"), "utf8")).resolves.toContain("demo");
  });
});
```

- [ ] **Step 2: Run workspace tests and confirm at least default persistence fails**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/workspace.test.ts
```

Expected: FAIL because the current default `/home/workspace` mount uses `OverlayFs`, so writes do not persist to `root`; `overlayPaths` is not implemented.

- [ ] **Step 3: Update workspace types**

Modify `plugins/workspace/src/types.ts`:

```ts
export interface WorkspaceConfig {
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
    executionLimits?: ExecutionLimits;
    network?: NetworkConfig;
    python?: boolean;
    javascript?: boolean;
  };
}

export type WorkspaceMountKind = "persistent" | "read-only" | "overlay";

export interface WorkspaceMountSummary {
  path: string;
  kind: WorkspaceMountKind;
}
```

Keep the existing tool input/result types only until Task 5 removes the custom tool files. If Task 5 deletes all custom tools, remove the unused legacy tool input/result types in the same task.

- [ ] **Step 4: Update filesystem construction**

Modify `plugins/workspace/src/workspace.ts` so `buildFilesystem()` validates mounts, uses `ReadWriteFs` for the default workspace, and supports overlays:

```ts
import { resolve } from "node:path";

import {
  Bash,
  InMemoryFs,
  type IFileSystem,
  MountableFs,
  OverlayFs,
  ReadWriteFs,
} from "just-bash";

import { assertValidMountConfig, DEFAULT_WORKSPACE_MOUNT } from "./mounts";
import type { WorkspaceConfig, WorkspaceMountSummary } from "./types";

export class Workspace {
  readonly bash: Bash;
  readonly config: WorkspaceConfig;
  readonly fs: IFileSystem;
  readonly mounts: WorkspaceMountSummary[];
  private _initialized = false;

  constructor(config: WorkspaceConfig) {
    this.config = config;
    const built = this.buildFilesystem();
    this.fs = built.fs;
    this.mounts = built.mounts;
    this.bash = new Bash({
      fs: this.fs,
      cwd: config.bash.cwd,
      env: config.bash?.env,
      executionLimits: config.bash?.executionLimits,
      network: config.bash?.network,
      python: config.bash?.python ?? false,
      javascript: config.bash?.javascript ?? false,
    });
  }

  private buildFilesystem(): { fs: MountableFs; mounts: WorkspaceMountSummary[] } {
    const root = resolve(this.config.root);
    const config = assertValidMountConfig(this.config.filesystem ?? {});
    const initialFiles = this.config.filesystem?.initialFiles ?? {};

    const mounts = [
      {
        mountPoint: DEFAULT_WORKSPACE_MOUNT,
        filesystem: new ReadWriteFs({ root }),
      },
      ...Object.entries(config.persistPaths).map(([mountPoint, hostPath]) => ({
        mountPoint,
        filesystem: new ReadWriteFs({ root: resolve(hostPath) }),
      })),
      ...Object.entries(config.readOnlyPaths).map(([mountPoint, hostPath]) => ({
        mountPoint,
        filesystem: new OverlayFs({ root: resolve(hostPath), mountPoint: "/", readOnly: true }),
      })),
      ...Object.entries(config.overlayPaths).map(([mountPoint, hostPath]) => ({
        mountPoint,
        filesystem: new OverlayFs({ root: resolve(hostPath), mountPoint: "/" }),
      })),
    ];

    return {
      fs: new MountableFs({
        base: new InMemoryFs(initialFiles),
        mounts,
      }),
      mounts: [
        { path: DEFAULT_WORKSPACE_MOUNT, kind: "persistent" },
        ...Object.keys(config.persistPaths).map((path) => ({ path, kind: "persistent" as const })),
        ...Object.keys(config.readOnlyPaths).map((path) => ({ path, kind: "read-only" as const })),
        ...Object.keys(config.overlayPaths).map((path) => ({ path, kind: "overlay" as const })),
      ],
    };
  }

  async init(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
  }

  get defaultTimeoutMs(): number {
    return this.config.bash?.timeoutMs ?? 30000;
  }
}
```

- [ ] **Step 5: Run workspace and mount tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/mounts.test.ts tests/workspace.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add plugins/workspace/src/types.ts plugins/workspace/src/workspace.ts plugins/workspace/tests/workspace.test.ts
git commit -m "feat(workspace): build channel filesystem mounts"
```

---

## Task 3: Bash-Tool Adapter And Default Tool Set

**Files:**
- Create: `plugins/workspace/src/bash-tool.ts`
- Test: `plugins/workspace/tests/bash-tool.test.ts`
- Later delete: old `plugins/workspace/src/tools/*.ts` only in Task 5 after plugin tests pass.

**Interfaces:**
- Consumes: `Workspace`.
- Produces: `createBashToolSet(workspace: Workspace): Promise<AgentToolSet>`.

- [ ] **Step 1: Write failing adapter tests**

Create `plugins/workspace/tests/bash-tool.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

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
    const writeFile = tools.find((tool) => tool.name === "writeFile")!;
    const readFile = tools.find((tool) => tool.name === "readFile")!;
    const bash = tools.find((tool) => tool.name === "bash")!;

    await writeFile.execute?.({ path: "note.txt", content: "hello\n" }, {} as never);
    const readResult = await readFile.execute?.({ path: "note.txt" }, {} as never);
    const bashResult = await bash.execute?.({ command: "cat note.txt" }, {} as never);

    expect(readResult).toEqual({ content: "hello\n" });
    expect(bashResult).toMatchObject({ stdout: "hello\n", exitCode: 0 });
  });
});
```

- [ ] **Step 2: Run adapter tests and confirm they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/bash-tool.test.ts
```

Expected: FAIL because `../src/bash-tool` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `plugins/workspace/src/bash-tool.ts`:

```ts
import type { AgentTool, AgentToolSet } from "@yesimbot/agent-runtime";
import { createBashTool, type Sandbox } from "bash-tool";

import type { Workspace } from "./workspace";

function createWorkspaceSandbox(workspace: Workspace): Sandbox {
  return {
    async executeCommand(command) {
      try {
        const result = await workspace.bash.exec(command, {
          signal: AbortSignal.timeout(workspace.defaultTimeoutMs),
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return {
            stdout: "",
            stderr: `Command timed out after ${workspace.defaultTimeoutMs}ms`,
            exitCode: 124,
          };
        }
        return {
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        };
      }
    },
    async readFile(path) {
      return workspace.fs.readFile(path, "utf8");
    },
    async writeFiles(files) {
      for (const file of files) {
        const content =
          typeof file.content === "string" ? file.content : file.content.toString("utf8");
        await workspace.fs.writeFile(file.path, content, "utf8");
      }
    },
  };
}

function namedTool(name: string, tool: Omit<AgentTool, "name">): AgentTool {
  return { name, ...tool } as AgentTool;
}

export async function createBashToolSet(workspace: Workspace): Promise<AgentToolSet> {
  const toolkit = await createBashTool({
    sandbox: createWorkspaceSandbox(workspace),
    destination: workspace.config.bash.cwd,
  });

  return [
    namedTool("bash", toolkit.tools.bash),
    namedTool("readFile", toolkit.tools.readFile),
    namedTool("writeFile", toolkit.tools.writeFile),
  ];
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/bash-tool.test.ts
```

Expected: PASS. If TypeScript complains about `Buffer.toString("utf8")`, change it to `file.content.toString("utf-8")` only if the local Node types require that spelling.

- [ ] **Step 5: Commit Task 3**

```bash
git add plugins/workspace/src/bash-tool.ts plugins/workspace/tests/bash-tool.test.ts
git commit -m "feat(workspace): adapt bash-tool tools"
```

---

## Task 4: Channel-Scoped Plugin Registration And Prompt

**Files:**
- Create: `plugins/workspace/src/prompt.ts`
- Modify: `plugins/workspace/src/index.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `createChannelWorkspaceId()` from Task 1.
- Consumes: `createBashToolSet()` from Task 3.
- Produces: channel-scoped agent plugin instances with prompt extensions.

- [ ] **Step 1: Write failing plugin tests**

Create `plugins/workspace/tests/plugin.test.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacePlugin from "../src";

function createMockCtx(baseDir: string) {
  const readyHandlers: Array<() => Promise<void> | void> = [];
  const disposeHandlers: Array<() => Promise<void> | void> = [];
  const factories: Array<(context: never) => AgentPlugin> = [];

  return {
    ctx: {
      baseDir,
      logger: () => ({
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
      on: vi.fn((event: string, handler: () => Promise<void> | void) => {
        if (event === "ready") readyHandlers.push(handler);
        if (event === "dispose") disposeHandlers.push(handler);
      }),
      yesimbot: {
        registerAgentPlugin: vi.fn((factory: (context: never) => AgentPlugin) => {
          factories.push(factory);
          return vi.fn();
        }),
      },
    },
    readyHandlers,
    disposeHandlers,
    factories,
  };
}

describe("WorkspacePlugin", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "yesimbot-plugin-"));
    await mkdir(baseDir, { recursive: true });
  });

  it("registers bash-tool default tools for a channel", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]();
    const plugin = mocks.factories[0]({
      channel: { platform: "onebot", selfId: "bot", channelId: "a", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const tools = await (plugin.tools as Function)();

    expect(tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      "bash",
      "readFile",
      "writeFile",
    ]);
  });

  it("isolates default workspace files by channel", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      timeoutMs: 1000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]();
    const factory = mocks.factories[0];
    const pluginA = factory({
      channel: { platform: "onebot", selfId: "bot", channelId: "a", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);
    const pluginB = factory({
      channel: { platform: "onebot", selfId: "bot", channelId: "b", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);

    const writeA = (await (pluginA.tools as Function)()).find(
      (tool: { name: string }) => tool.name === "writeFile",
    );
    const readB = (await (pluginB.tools as Function)()).find(
      (tool: { name: string }) => tool.name === "readFile",
    );

    await writeA.execute({ path: "note.txt", content: "channel-a" }, {} as never);
    await expect(readB.execute({ path: "note.txt" }, {} as never)).rejects.toThrow();
  });

  it("extends prompt with sandbox and mount policy", async () => {
    const mocks = createMockCtx(baseDir);
    new WorkspacePlugin(mocks.ctx as never, {
      root: "workspace",
      cwd: "/home/workspace",
      persistPaths: { "/shared": "shared" },
      readOnlyPaths: { "/knowledge": "knowledge" },
      overlayPaths: { "/repo": "repo" },
      timeoutMs: 5000,
      enableNetwork: false,
    });

    await mocks.readyHandlers[0]();
    const plugin = mocks.factories[0]({
      channel: { platform: "onebot", selfId: "bot", channelId: "a", type: "text" },
      platform: { name: "onebot", unsafeBot: {} },
    } as never);

    const prompt = await plugin.extendSystemPrompt?.("base", {} as never);

    expect(prompt).toContain("just-bash");
    expect(prompt).toContain("/home/workspace");
    expect(prompt).toContain("channel");
    expect(prompt).toContain("Network access: disabled");
    expect(prompt).toContain("Command timeout: 5000 ms");
    expect(prompt).toContain("/shared");
    expect(prompt).toContain("/knowledge");
    expect(prompt).toContain("/repo");
  });
});
```

- [ ] **Step 2: Run plugin tests and confirm they fail**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts
```

Expected: FAIL because `readOnlyPaths` and `overlayPaths` are not in the top-level config and the plugin still registers a single global workspace with old custom tools.

- [ ] **Step 3: Implement prompt formatter**

Create `plugins/workspace/src/prompt.ts`:

```ts
import type { Workspace } from "./workspace";

export function formatWorkspacePrompt(workspace: Workspace): string {
  const { bash } = workspace.config;
  const networkState = bash.network ? "enabled" : "disabled";
  const mountLines = workspace.mounts.map((mount) => `- ${mount.path}: ${mount.kind}`);

  return [
    "## Workspace Sandbox",
    "You can use workspace tools backed by a just-bash virtual Bash sandbox.",
    `Current working directory: ${bash.cwd}`,
    "Workspace scope: channel-isolated. Files in /home/workspace are shared only within this Koishi channel context.",
    `Network access: ${networkState}`,
    `Command timeout: ${workspace.defaultTimeoutMs} ms`,
    "",
    "Filesystem mounts:",
    ...mountLines,
    "",
    "Shell state such as cd, aliases, functions, and exported variables does not persist between bash calls. Filesystem changes do persist within the channel workspace.",
    "Use readFile for known files, writeFile for complete file writes, and bash for listing, searching, transformations, and pipelines.",
    "Use help or which before assuming a host binary exists; this is not the host shell.",
  ].join("\n");
}
```

- [ ] **Step 4: Update plugin config and lifecycle**

Modify `plugins/workspace/src/index.ts` with these structural changes:

```ts
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentPlugin } from "@yesimbot/agent-runtime";
import { Context, Logger, Schema } from "koishi";
import type {} from "koishi-plugin-yesimbot";

import { createBashToolSet } from "./bash-tool";
import { assertValidMountConfig, createChannelWorkspaceId } from "./mounts";
import { formatWorkspacePrompt } from "./prompt";
import type { WorkspaceConfig } from "./types";
import { Workspace } from "./workspace";

export interface WorkspacePluginConfig {
  root: string;
  cwd: string;
  persistPaths?: Record<string, string>;
  readOnlyPaths?: Record<string, string>;
  overlayPaths?: Record<string, string>;
  timeoutMs?: number;
  enableNetwork?: boolean;
  enablePython?: boolean;
  enableJavascript?: boolean;
}
```

Update `Config`:

```ts
readOnlyPaths: Schema.dict(
  Schema.path({ filters: ["directory", "file"], allowCreate: true }),
).description("只读路径映射"),
overlayPaths: Schema.dict(
  Schema.path({ filters: ["directory", "file"], allowCreate: true }),
).description("覆盖层路径映射：读取宿主目录，写入保留在虚拟文件系统中"),
```

Replace the single `ws` field with:

```ts
private workspaces = new Map<string, Workspace>();
private rootPath?: string;
private mountConfig?: ReturnType<typeof assertValidMountConfig>;
```

In `start()`, validate and register only:

```ts
const root = resolve(this.ctx.baseDir, this.config.root);
const mountConfig = assertValidMountConfig({
  persistPaths: this.resolveHostPathMap(this.config.persistPaths),
  readOnlyPaths: this.resolveHostPathMap(this.config.readOnlyPaths),
  overlayPaths: this.resolveHostPathMap(this.config.overlayPaths),
});

await mkdir(root, { recursive: true });
for (const hostPath of [
  ...Object.values(mountConfig.persistPaths),
  ...Object.values(mountConfig.readOnlyPaths),
  ...Object.values(mountConfig.overlayPaths),
]) {
  await mkdir(hostPath, { recursive: true });
}

this.rootPath = root;
this.mountConfig = mountConfig;
this.disposeAgentPlugin?.();
this.disposeAgentPlugin = this.ctx.yesimbot.registerAgentPlugin((channelContext) =>
  this.createAgentPlugin(channelContext),
);
```

Add helper methods:

```ts
private resolveHostPathMap(paths?: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [virtualPath, hostPath] of Object.entries(paths ?? {})) {
    resolved[virtualPath] = resolve(this.ctx.baseDir, hostPath);
  }
  return resolved;
}

private getWorkspace(channelContext: {
  channel: { platform: string; selfId: string; channelId: string };
}): Workspace {
  if (!this.rootPath || !this.mountConfig) {
    throw new Error("Workspace plugin is not started");
  }

  const workspaceId = createChannelWorkspaceId(channelContext.channel);
  const existing = this.workspaces.get(workspaceId);
  if (existing) return existing;

  const workspaceConfig: WorkspaceConfig = {
    root: join(this.rootPath, "channels", workspaceId),
    filesystem: this.mountConfig,
    bash: {
      cwd: this.config.cwd,
      timeoutMs: this.config.timeoutMs,
      network: this.config.enableNetwork ? { dangerouslyAllowFullInternetAccess: true } : undefined,
    },
  };

  const workspace = new Workspace(workspaceConfig);
  this.workspaces.set(workspaceId, workspace);
  return workspace;
}

private createAgentPlugin(channelContext: Parameters<Context["yesimbot"]["registerAgentPlugin"]>[0] extends (context: infer C) => AgentPlugin ? C : never): AgentPlugin {
  const workspace = this.getWorkspace(channelContext as { channel: { platform: string; selfId: string; channelId: string } });
  return {
    name: "workspace",
    async init() {
      await workspace.init();
    },
    tools: async () => createBashToolSet(workspace),
    extendSystemPrompt(prompt) {
      return `${prompt}\n\n${formatWorkspacePrompt(workspace)}`;
    },
  };
}
```

If the type expression for `createAgentPlugin` is too awkward, import `ChannelAgentContext` from `koishi-plugin-yesimbot/shared` only if that path is already exported. Otherwise define a local minimal type:

```ts
interface WorkspaceChannelContext {
  channel: {
    platform: string;
    selfId: string;
    channelId: string;
  };
}
```

Use the local type in `createAgentPlugin(context: WorkspaceChannelContext): AgentPlugin`.

- [ ] **Step 5: Update stop lifecycle**

In `plugins/workspace/src/index.ts`, make `stop()` clear cached workspaces:

```ts
public async stop(): Promise<void> {
  this.disposeAgentPlugin?.();
  this.disposeAgentPlugin = undefined;
  this.workspaces.clear();
  this.rootPath = undefined;
  this.mountConfig = undefined;
  this.logger.info("Workspace plugin stopped");
}
```

- [ ] **Step 6: Run plugin tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts tests/bash-tool.test.ts tests/workspace.test.ts tests/mounts.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add plugins/workspace/src/index.ts plugins/workspace/src/prompt.ts plugins/workspace/tests/plugin.test.ts
git commit -m "feat(workspace): scope tools by channel"
```

---

## Task 5: Remove Legacy Custom Tool Implementation

**Files:**
- Delete: `plugins/workspace/src/tools/edit-file.ts`
- Delete: `plugins/workspace/src/tools/execute-command.ts`
- Delete: `plugins/workspace/src/tools/glob.ts`
- Delete: `plugins/workspace/src/tools/grep.ts`
- Delete: `plugins/workspace/src/tools/helpers.ts`
- Delete: `plugins/workspace/src/tools/index.ts`
- Delete: `plugins/workspace/src/tools/read-file.ts`
- Delete: `plugins/workspace/src/tools/write-file.ts`
- Delete or replace: old custom tool tests under `plugins/workspace/tests/`
- Modify: `plugins/workspace/src/types.ts`

**Interfaces:**
- Consumes: `createBashToolSet()` from Task 3 as the only default tool factory.
- Produces: no legacy default custom tool layer.

- [ ] **Step 1: Confirm no source imports old custom tools**

Run:

```bash
rtk proxy rg -n "createWorkspaceTools|createReadFileTool|createWriteFileTool|createEditFileTool|createGrepTool|createGlobTool|createExecuteCommandTool|\\.\\/tools" plugins/workspace/src
```

Expected after Task 4: no matches in `plugins/workspace/src/index.ts`; matches only inside `plugins/workspace/src/tools` are safe to remove.

- [ ] **Step 2: Delete old custom tool source files**

Run:

```bash
git rm plugins/workspace/src/tools/edit-file.ts plugins/workspace/src/tools/execute-command.ts plugins/workspace/src/tools/glob.ts plugins/workspace/src/tools/grep.ts plugins/workspace/src/tools/helpers.ts plugins/workspace/src/tools/index.ts plugins/workspace/src/tools/read-file.ts plugins/workspace/src/tools/write-file.ts
```

Expected: files are staged for deletion.

- [ ] **Step 3: Delete old custom tool tests**

Run:

```bash
git rm plugins/workspace/tests/edit-file.test.ts plugins/workspace/tests/execute-command.test.ts plugins/workspace/tests/glob.test.ts plugins/workspace/tests/grep.test.ts plugins/workspace/tests/helpers.test.ts plugins/workspace/tests/read-file.test.ts plugins/workspace/tests/write-file.test.ts plugins/workspace/tests/helpers.ts
```

Expected: files are staged for deletion. Keep the new tests from Tasks 1-4.

- [ ] **Step 4: Remove unused legacy types**

In `plugins/workspace/src/types.ts`, remove tool-specific input/output types that no longer have source consumers:

```ts
export interface ReadFileInput { ... }
export interface WriteFileInput { ... }
export interface EditFileInput { ... }
export interface GrepInput { ... }
export interface GlobInput { ... }
export interface ExecuteCommandInput { ... }
export interface ErrorResult { ... }
export interface SuccessResult { ... }
export interface ReadFileResult { ... }
export interface WriteResult { ... }
export interface GrepResult { ... }
export interface GlobResult { ... }
export interface ExecuteResult { ... }
export type ToolResult<T> = T | ErrorResult;
export interface WorkspaceToolDefinitions { ... }
export type WorkspaceToolSet = ...
```

Keep only `WorkspaceConfig`, `ExecutionLimits`, `NetworkConfig`, `WorkspaceMountKind`, and `WorkspaceMountSummary`.

- [ ] **Step 5: Run type checks and tests for the package**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
```

Expected: PASS. If `tsconfig` still includes deleted files through stale build info, run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace run clean
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
```

- [ ] **Step 6: Commit Task 5**

```bash
git add plugins/workspace/src/types.ts
git commit -m "refactor(workspace): remove custom tool layer"
```

---

## Task 6: README And Operator Documentation

**Files:**
- Create or modify: `plugins/workspace/README.md`
- Optionally modify: `plugins/workspace/docs/just-bash.md`

**Interfaces:**
- Consumes: final config names from Tasks 2 and 4.
- Produces: user-facing documentation for Koishi operators.

- [ ] **Step 1: Write README content**

Create `plugins/workspace/README.md` with this structure:

```md
# koishi-plugin-yesimbot-workspace

Workspace tools for YesImBot agents, backed by `just-bash` and `bash-tool`.

## What It Provides

- `bash`: run supported Unix-style commands in a `just-bash` virtual sandbox.
- `readFile`: read a known file from the virtual workspace.
- `writeFile`: write a complete file into the virtual workspace.

The default writable workspace is channel-isolated. A Koishi channel identified
by `platform:selfId:channelId` gets its own persistent `/home/workspace`.

## Configuration

| Option | Meaning |
| --- | --- |
| `root` | Host directory where channel workspaces are stored. |
| `cwd` | Virtual working directory used by `bash-tool`. |
| `persistPaths` | Extra writable host-backed mounts. |
| `readOnlyPaths` | Read-only host-backed mounts. |
| `overlayPaths` | Copy-on-write host-backed mounts. |
| `timeoutMs` | Bash command timeout in milliseconds. |
| `enableNetwork` | Enables network commands in the sandbox. |

## Examples

### Private or group channel workspace

```yaml
root: data/yesimbot/workspace
cwd: /home/workspace
enableNetwork: false
```

### Group project assistant

```yaml
cwd: /home/workspace
readOnlyPaths:
  /knowledge: data/project-docs
persistPaths:
  /shared: data/yesimbot/shared
```

### Safe codebase inspection

```yaml
cwd: /home/workspace
readOnlyPaths:
  /repo: /home/workspace/Athena
```

### Code experiments without host writes

```yaml
cwd: /repo
overlayPaths:
  /repo: /home/workspace/Athena
```

### Trusted maintenance channel

```yaml
cwd: /repo
persistPaths:
  /repo: /home/workspace/Athena
```

Use writable host-backed mounts only for trusted operators and trusted channels.
The agent can modify files under these mounts.

## Sandbox Notes

`just-bash` is a virtual Bash interpreter, not the host shell. Shell state such
as `cd`, aliases, functions, and exported variables does not persist between
`bash` calls. Filesystem changes do persist inside the channel workspace.

Network access is disabled by default. When enabled, network commands such as
`curl` become available according to the configured sandbox network policy.

`@vercel/sandbox` is not the default backend. Use a full VM backend only when
you need arbitrary binaries or stronger VM isolation.
```

- [ ] **Step 2: Run markdown readback**

Run:

```bash
rtk proxy sed -n '1,260p' plugins/workspace/README.md
```

Expected: README includes default tools, channel isolation, mount examples, network notes, and writable mount warning.

- [ ] **Step 3: Commit Task 6**

```bash
git add plugins/workspace/README.md plugins/workspace/docs/just-bash.md
git commit -m "docs(workspace): document sandbox mounts"
```

If `plugins/workspace/docs/just-bash.md` was not changed, omit it from `git add`.

---

## Task 7: Final Verification And OpenSpec Task Updates

**Files:**
- Modify: `openspec/changes/improve-workspace-just-bash-integration/tasks.md`
- No source files unless verification reveals a defect.

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: checked OpenSpec task list and verification evidence for the next verify phase.

- [ ] **Step 1: Run package tests**

Run:

```bash
rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run
```

Expected: PASS.

- [ ] **Step 2: Run package type check**

Run:

```bash
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-workspace
```

Expected: PASS.

- [ ] **Step 3: Run OpenSpec validation**

Run:

```bash
rtk openspec validate improve-workspace-just-bash-integration --strict
```

Expected: PASS.

- [ ] **Step 4: Update OpenSpec task checkboxes**

In `openspec/changes/improve-workspace-just-bash-integration/tasks.md`, mark completed implementation tasks with `[x]` only after the corresponding tests and checks pass. Keep incomplete or intentionally deferred work unchecked and explain it in the final execution report.

- [ ] **Step 5: Commit verification bookkeeping**

```bash
git add openspec/changes/improve-workspace-just-bash-integration/tasks.md
git commit -m "chore(workspace): mark implementation tasks complete"
```

---

## Self-Review

- Spec coverage: Channel isolation is covered by Tasks 1, 2, and 4. Bash-tool default tools are covered by Tasks 3 and 4. Virtual filesystem boundaries are covered by Tasks 2 and 3. Mount intent and validation are covered by Tasks 1 and 2. Prompt and docs are covered by Tasks 4 and 6.
- Placeholder scan: no unresolved placeholder markers or undefined placeholder sections remain in this plan.
- Type consistency: the plan consistently uses `Workspace`, `WorkspaceConfig`, `WorkspaceMountSummary`, `createBashToolSet`, `assertValidMountConfig`, `createChannelWorkspaceId`, and `formatWorkspacePrompt`.
