# Workspace Host Bash Execution Modes Implementation Plan

> **For future implementers:** Implement this plan inline with explicit review checkpoints. Do not dispatch subagents or create commits unless the user separately authorizes implementation and commits.

**Goal:** Add an explicit, approval-gated Host Bash backend while preserving the existing Sandbox as the default Workspace execution mode.

**Architecture:** Keep `bash-tool` as the single Agent-facing tool shell. Sandbox and Host provide different backends; Host owns a real Bash runner and a separate policy module for channel admission, Host roots, just-bash AST risk classification, approval, and audit. Host never constructs the virtual Workspace filesystem.

**Tech Stack:** TypeScript, Koishi Schema/commands, `bash-tool@1.3.18` contract, `just-bash@3.2.0` parser/AST, Node `child_process`, Node filesystem APIs, Vitest.

## Global Constraints

- `bash.mode` defaults to `sandbox`; missing/invalid Host admission is deny-by-default.
- Sandbox exposes only `bash`, `readFile`, and `writeFile`; do not add Git or `host-exec`.
- Host requires an existing configured `{ uid, gid }`; never fall back to the Koishi process identity.
- Host inherits the complete `process.env`; documentation and audit must not claim secret confidentiality.
- Risky or parser-unsupported commands require explicit approval; no Agent-facing approval tool exists.
- Approval commands are `yesimbot.workspace.*` and require Koishi authority level 5.
- Approval binds Scope, tool, cwd, policy revision, and original command fingerprint for 60 seconds.
- Host processes use one plugin-global slot, non-interactive stdin, bounded output, timeout, process-group cleanup, and plugin-stop cancellation.
- Sandbox mount sources resolve relative to `ctx.baseDir`; mount targets are absolute, non-nested, and mode is `rw`, `ro`, or `overlay`.
- Do not restore legacy storage layouts, data formats, or architecture. Do not modify source during this design-record phase.

---

### Task 1: Restore the Sandbox baseline

**Files:**
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Delete during implementation: `plugins/workspace/src/git-tool.ts`
- Delete during implementation: `plugins/workspace/tests/git-tool.test.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**
- Produces the unchanged Sandbox tool contract: `bash`, `readFile`, `writeFile`.
- Removes `enableGit`, `createGitToolSet`, `hostTmpRoot`, `resolveTempMount`, and `host-exec` registration.

- [ ] **Step 1: Capture the current WIP diff and identify only Git/Host-temp hunks**

  Use `git diff -- plugins/workspace` and the exhaustive reference scan recorded in the OpenSpec brainstorm. Do not revert unrelated just-bash ESM/worker changes.

- [ ] **Step 2: Remove Git-specific source and tests**

  Delete `src/git-tool.ts` and `tests/git-tool.test.ts`. Remove imports, schema, registration, and temp-mount plumbing from the existing files.

- [ ] **Step 3: Restore the Sandbox tool assertion**

  Update the plugin integration expectation to exactly:

  ```ts
  expect(Object.keys(tools).sort()).toEqual(["bash", "readFile", "writeFile"]);
  ```

- [ ] **Step 4: Run the focused Sandbox tests**

  Run: `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/workspace.test.ts`

  Expected: the tests cover only the existing Sandbox behavior and do not mention Git or Host temporary mounts.

---

### Task 2: Add discriminated configuration and normalized mounts

**Files:**
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/mounts.ts`
- Test: `plugins/workspace/tests/mounts.test.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**

```ts
type BashConfig =
  | {
      mode: "sandbox";
      mounts: readonly MountSpec[];
      enableNetwork?: boolean;
      enablePython?: boolean;
      enableJavascript?: boolean;
    }
  | {
      mode: "host";
      allowedChannels: readonly HostChannelRule[];
      hostRoots: readonly HostRootSpec[];
      identity: { uid: number; gid: number };
    };

interface MountSpec {
  source: string;
  target: string;
  mode: "rw" | "ro" | "overlay";
}
```

- [ ] **Step 1: Write failing Schema tests for mode branches**

  Cover omitted mode defaulting to Sandbox, Host requiring `allowedChannels` and `identity`, and mode-specific fields not being silently applied to the opposite branch.

- [ ] **Step 2: Implement the common-plus-union Schema**

  Use the repository’s `Schema.intersect` convention. Keep existing Sandbox options in the Sandbox branch and keep Host roots/identity in the Host branch.

- [ ] **Step 3: Write failing mount normalization tests**

  Cover relative `source` resolution against `ctx.baseDir`, creation of missing `rw` directories, required existing `ro/overlay` directories, target normalization, `/` rejection, reserved `/home/workspace`, duplicate targets, and parent/child conflicts.

- [ ] **Step 4: Replace map normalization with `MountSpec[]` normalization**

  Return a normalized list or normalized lookup used only by Sandbox construction. Preserve default workspace and internal skill mounts without exposing them as Host configuration.

- [ ] **Step 5: Run mount and Schema tests**

  Run: `npx vitest run plugins/workspace/tests/mounts.test.ts plugins/workspace/tests/plugin.test.ts`

  Expected: all mount conflicts fail before filesystem construction and Sandbox remains the default.

---

### Task 3: Unify `bash-tool` backend construction

**Files:**
- Modify: `plugins/workspace/src/bash-tool.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Inspect/possibly modify dependency seam: `node_modules/bash-tool` source or the maintained dependency source, only if required by its supported workflow
- Test: `plugins/workspace/tests/bash-tool.test.ts`

**Interfaces:**

```ts
interface WorkspaceBashBackend {
  executeCommand(
    command: string,
    options?: { cwd?: string; signal?: AbortSignal },
  ): Promise<unknown>;
  readFile(path: string): Promise<string>;
  writeFiles(files: readonly { path: string; content: string }[]): Promise<void>;
}

function createBashToolSet(input: {
  backend: WorkspaceBashBackend;
  destination: string;
  environment: "sandbox" | "host";
}): Record<string, unknown>;
```

- [ ] **Step 1: Inspect the installed `bash-tool` API before changing it**

  Confirm whether its `Sandbox.executeCommand` can receive structured cwd and abort information. If the current destination wrapper is safely quoted and sufficient, do not modify the dependency.

- [ ] **Step 2: Write backend parity tests using a fake backend**

  Assert that Sandbox and Host backend inputs produce the same three tool names, schemas, result shape, output truncation behavior, and abort propagation.

- [ ] **Step 3: Refactor Workspace tool creation around the existing Sandbox contract**

  Keep all Agent-facing tool construction in the shared path. Only the backend implementation and environment description differ.

- [ ] **Step 4: Add the minimal structured cwd seam if needed**

  Pass cwd and signal as data to the backend instead of parsing a shell-generated `cd` prefix. Keep just-bash behavior unchanged for the Sandbox backend.

- [ ] **Step 5: Run backend parity tests**

  Run: `npx vitest run plugins/workspace/tests/bash-tool.test.ts`

  Expected: no `host-exec` schema or second output protocol exists.

---

### Task 4: Implement the Host process runner

**Files:**
- Modify: `plugins/workspace/src/host-engine.ts`
- Test: `plugins/workspace/tests/host-engine.test.ts`

**Interfaces:**

```ts
interface HostRunner {
  run(input: {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    uid: number;
    gid: number;
    signal: AbortSignal;
  }): Promise<HostCommandResult>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write a safe real-process smoke test**

  Use a temporary directory and a harmless command such as `/bin/pwd` to assert the real cwd and exit code. Keep the test Unix-gated because Host Bash and uid/gid process groups are Unix requirements.

- [ ] **Step 2: Spawn non-interactive Bash with bounded streams**

  Use `/bin/bash --noprofile --norc -c <original command>`, `stdio: ["ignore", "pipe", "pipe"]`, the real cwd, and complete `process.env`. Drain both streams while retaining only the configured bounded output.

- [ ] **Step 3: Add identity and process-group setup**

  Require numeric uid/gid, clear supplementary groups where supported, start a dedicated process group, and track every child in a plugin-global Set.

- [ ] **Step 4: Add timeout and AbortSignal cleanup**

  Send TERM to the process group, wait the bounded grace interval, then send KILL. Map timeout to the existing Bash tool convention and ensure every child leaves the tracking Set.

- [ ] **Step 5: Add the global single-slot queue and stop behavior**

  Allow one active Host process across all channels. Abort queued work, pending execution, and active process groups when the runner stops.

- [ ] **Step 6: Test cwd, env, exit, timeout, abort, output, and cleanup**

  Run: `npx vitest run plugins/workspace/tests/host-engine.test.ts`

  Expected: no test leaves a child process running after completion.

---

### Task 5: Implement Host roots and AST risk policy

**Files:**
- Create/modify: `plugins/workspace/src/host-policy.ts`
- Test: `plugins/workspace/tests/host-policy.test.ts`

**Interfaces:**

```ts
type HostPolicyDecision =
  | { kind: "allow" }
  | { kind: "approve"; fingerprint: string; riskTags: string[]; summary: string };

interface HostPolicy {
  checkChannel(scope: ChannelScope): boolean;
  checkFile(tool: "readFile" | "writeFile", path: string): void;
  classify(scope: ChannelScope, toolName: string, input: unknown): HostPolicyDecision;
}
```

- [ ] **Step 1: Write AST classification tests**

  Cover direct read-only commands as allow; writes, deletion, redirects, network commands, interpreters, background commands, substitutions, dynamic words, and unsupported syntax as approve. Include a nested `$(...)` command to prove recursive traversal.

- [ ] **Step 2: Import the public `just-bash.parse` API**

  Keep parser use pure. Do not import private parser implementation paths and do not add a handwritten shell lexer.

- [ ] **Step 3: Implement conservative AST walking**

  Extract literal command names, words, redirections, assignments, nested commands, and process markers. Treat parser failure and unknown/dynamic structure as `parser-unsupported` approval.

- [ ] **Step 4: Implement exact request fingerprinting**

  Hash normalized Scope, tool name, real cwd, policy revision, and original command bytes. Do not use the fingerprint to authenticate the administrator.

- [ ] **Step 5: Implement Host root canonicalization**

  Resolve direct file paths, reject NUL/traversal/final symlink/out-of-root paths, enforce ro/rw mode, and reject files above the fixed read cap.

- [ ] **Step 6: Run policy tests**

  Run: `npx vitest run plugins/workspace/tests/host-policy.test.ts`

  Expected: ordinary commands allow, risky and unsupported commands request approval, and no command string is rewritten.

---

### Task 6: Add approval broker, notifications, and audit

**Files:**
- Modify: `plugins/workspace/src/host-policy.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/prompt.ts`
- Test: `plugins/workspace/tests/host-policy.test.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`

**Interfaces:**

```ts
interface HostApprovalBroker {
  request(
    request: HostApprovalRequest,
    signal: AbortSignal,
  ): Promise<"approved" | "rejected" | "expired">;
  stop(): void;
}
```

- [ ] **Step 1: Write broker transition tests**

  Cover pending notification, authority-5 approve, unauthorized approve, reject, expiry at 60 seconds, abort, plugin stop, exact fingerprint mismatch, and repeated same-fingerprint calls within the TTL.

- [ ] **Step 2: Implement memory-only request state**

  Keep request IDs unique, bind every request to Scope/tool/cwd/policy/fingerprint, invalidate requests on reload/stop, and never persist them to JSONL.

- [ ] **Step 3: Register authority-5 Koishi commands**

  Register `yesimbot.workspace.approvals`, `yesimbot.workspace.approve <requestId>`, and `yesimbot.workspace.reject <requestId>`. Enforce `session.user.authority >= 5` for all three under `yesimbot.workspace.*`.

- [ ] **Step 4: Send a redacted originating-channel notification**

  Use `ChannelPluginContext.bot.sendMessage(scope.channelId, ...)`. Include request ID, risk tags, redacted summary, expiry, and administrator commands. Never retain the originating Session or include raw secrets/content.

- [ ] **Step 5: Add minimal logger audit events**

  Record lifecycle state, Scope, tool, fingerprint, risk tags, policy revision, approval actor, duration, exit/signal, and truncation/cancellation flags. Exclude raw command text, environment values, output, and file contents.

- [ ] **Step 6: Run approval and command tests**

  Run: `npx vitest run plugins/workspace/tests/host-policy.test.ts plugins/workspace/tests/plugin.test.ts`

  Expected: approval releases the original pending call; rejection and expiry return block without an Agent-facing approval tool.

---

### Task 7: Wire mode-specific Runtime assembly and prompt

**Files:**
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/prompt.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`
- Test: `plugins/workspace/tests/workspace.test.ts`

**Interfaces:**

```ts
function createChannelPlugin(context: ChannelPluginContext): Promise<AgentPlugin | null>;
```

- [ ] **Step 1: Write mode assembly tests**

  Cover Sandbox default, Host allowlist match, Host allowlist miss, Host no virtual Workspace construction, and old Runtime configuration snapshots after a config change.

- [ ] **Step 2: Wire Sandbox branch**

  Keep existing Workspace creation, virtual mount assembly, skill mounts, Sandbox prompt, and channel persistence. Do not consult Host allowlisting in this branch.

- [ ] **Step 3: Wire Host branch**

  Gate registration before tool creation, create the real channel workspace directory, create Host backend/policy/runner references, and keep virtual Workspace construction unreachable.

- [ ] **Step 4: Install the operational Host prompt**

  Tell the Agent that commands run on real host Bash and the channel host workspace; generate one complete call; avoid sensitive files and broad changes; expect `beforeToolCall` approval pauses; stop after rejection/timeout without rewriting or retrying.

- [ ] **Step 5: Run plugin and workspace tests**

  Run: `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/workspace.test.ts`

  Expected: Sandbox behavior is unchanged and Host tools are present only for an allowlisted channel.

---

### Task 8: Complete focused verification and deployment gate

**Files:**
- Test/inspect: all files touched by Tasks 1–7
- Record: OpenSpec change artifacts only

- [ ] **Step 1: Run the complete focused Workspace test set**

  Run: `npx vitest run plugins/workspace/tests`

- [ ] **Step 2: Run the Workspace type check/build command required by the repository**

  Use the package-scoped command from `AGENTS.md`; do not use a workspace `exec` path that lacks `tsc`.

- [ ] **Step 3: Verify Host failure-closed cases**

  Confirm missing/invalid identity, roots, cwd, process-group support, and approval transport never execute a Host command.

- [ ] **Step 4: Verify parser compatibility corpus**

  Compare representative commands with `/bin/bash -n`; ensure parser failures require approval and parser success is not treated as an isolation guarantee.

- [ ] **Step 5: Verify Sandbox rollback inventory**

  Search the full workspace for `git-tool`, `createGitToolSet`, `enableGit`, `host-exec`, and `hostTmpRoot`; only intentional OpenSpec history or generated metadata may remain.

- [ ] **Step 6: Stop at implementation review**

  Do not enable Host mode in production channels until authority-5 approval commands, notification behavior, low-privilege identity, process cleanup, and audit redaction have been reviewed.
