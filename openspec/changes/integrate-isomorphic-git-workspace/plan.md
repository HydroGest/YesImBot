# Integrate isomorphic-git into the sandbox Workspace Implementation Plan

> **For agentic workers:** Implement this plan inline in the main session. Do not dispatch execution subagents, do not touch user-owned unrelated changes, and do not commit without explicit authorization.

**Goal:** Remove real-host Bash execution from `plugins/workspace` and add a lazy, sandboxed isomorphic-git command with public HTTPS remotes guarded by `enableNetwork` and terminal-wildcard URL prefixes.

**Architecture:** `Workspace` remains the sole owner of the channel-scoped `MountableFs` and registers a lazy `git` custom command with the existing just-bash instance. `src/git.ts` adapts only the required filesystem and HTTP seams; it never opens Node host paths or starts a process. Host runner/policy code is deleted rather than replaced by another backend.

**Tech Stack:** TypeScript, Koishi Schema, just-bash custom commands and secure fetch, registry `isomorphic-git`, Vitest, TypeScript compiler.

---

## Global Constraints

- `bash.mode` is removed; sandbox is the only Workspace execution backend.
- `bash.enableNetwork` is false-by-default and does not bypass an empty URL allowlist.
- `bash.allowedUrlPrefixes` accepts absolute HTTP(S) prefixes with one optional terminal `*`; wildcard placement elsewhere is invalid.
- Git remote support is public HTTPS `clone`, `fetch`, and `pull` only; SSH, credentials, custom secret headers, and `push` are rejected.
- All Git filesystem access uses the current `MountableFs`; no Node `fs`, `child_process`, or host `git` executable is reachable from the Git command.
- Default `/home/workspace` and `rw` mounts persist; `ro` rejects writes; `overlay` does not write back.
- Do not copy or depend on source files under `references/isomorphic-git`; use the registry package.
- Do not overwrite the existing root `package.json` user change.

---

## Task 1: Remove the Host execution path

**Files:**
- Delete: `plugins/workspace/src/host-engine.ts`
- Delete: `plugins/workspace/src/host-policy.ts`
- Delete: `plugins/workspace/tests/host-engine.test.ts`
- Delete: `plugins/workspace/tests/host-policy.test.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/bash-tool.ts`
- Modify: `plugins/workspace/src/prompt.ts`
- Test: `plugins/workspace/tests/plugin.test.ts`, `bash-tool.test.ts`, `workspace.test.ts`

- [ ] **Step 1:** Remove `mode: "sandbox"` from existing sandbox fixtures and add assertions that only the virtual Workspace backend and the three existing Agent tools are initialized.
- [ ] **Step 2:** Delete the Host runner, policy, and Host-only test files; retain mount, skill, workspace, resource-reader, and channel-isolation files.
- [ ] **Step 3:** Collapse `BashConfig` to the sandbox configuration in `types.ts`; delete Host types and remove the `mode` schema field.
- [ ] **Step 4:** Remove Host imports, fields, lifecycle branches, admission checks, approval commands, and helper functions from `index.ts`.
- [ ] **Step 5:** Remove the host environment branch from `bash-tool.ts` and delete the Host prompt formatter from `prompt.ts`; retain existing sandbox tool schemas and result behavior.
- [ ] **Step 6:** Run `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/bash-tool.test.ts plugins/workspace/tests/workspace.test.ts` and confirm the remaining sandbox tests pass.

---

## Task 2: Normalize the sandbox network allowlist

**Files:**
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Create: `plugins/workspace/tests/network.test.ts` when no suitable existing network test exists

**Interface:**

```ts
interface SandboxBashConfig {
  enableNetwork?: boolean;
  allowedUrlPrefixes?: string[];
}

function normalizeAllowedUrlPrefixes(entries: readonly string[]): string[];
```

- [ ] **Step 1:** Add tests for disabled network, empty allowlists, valid terminal-wildcard entries, prefix boundaries, and invalid wildcard placement.
- [ ] **Step 2:** Add the string-array `allowedUrlPrefixes` schema field with an empty default; accept one optional terminal `*` and remove it during normalization.
- [ ] **Step 3:** Reject non-absolute or unsupported URL patterns and never turn an empty allowlist into full Internet access.
- [ ] **Step 4:** Pass the normalized list to just-bash with only `GET`, `HEAD`, and `POST`, private-range denial, and existing timeout/response limits.
- [ ] **Step 5:** Run `npx vitest run plugins/workspace/tests/network.test.ts` and confirm no external request is made.

---

## Task 3: Add the virtual-filesystem Git command

**Files:**
- Modify: `plugins/workspace/package.json`
- Modify: `yarn.lock`
- Create: `plugins/workspace/src/git.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Create/modify: `plugins/workspace/tests/git.test.ts`

**Interface:**

```ts
function createGitCommand(options: {
  network?: NetworkConfig;
}): CustomCommand;
```

This is an internal command seam, not a public `GitClient` or separate AgentTool API.

- [ ] **Step 1:** Add failing tests for `init`, `add`, `config`, `commit`, `status`, `log`, `diff`, `branch`, `checkout`, mount persistence, cancellation, and unsupported operations.
- [ ] **Step 2:** Add the registry `isomorphic-git` dependency and update only its Yarn lock entries; do not use the source-only `references/isomorphic-git` path.
- [ ] **Step 3:** Implement the narrow PromiseFsClient adapter over `MountableFs`, preserving bytes, stat information, virtual paths, and `rm`/`rmdir` semantics.
- [ ] **Step 4:** Register a lazy custom `git` command from `Workspace` and dynamically import isomorphic-git only on first invocation.
- [ ] **Step 5:** Dispatch only the approved local subcommands and return the existing custom-command result shape for success and failure.
- [ ] **Step 6:** Run `npx vitest run plugins/workspace/tests/git.test.ts` and fix any adapter or mount-persistence failures.

---

## Task 4: Add public HTTPS remote Git

**Files:**
- Modify: `plugins/workspace/src/git.ts`
- Test: `plugins/workspace/tests/git.test.ts`

- [ ] **Step 1:** Add mock transport tests for allowlisted HTTPS `clone`, `fetch`, and `pull`, disabled network, empty allowlist, URL rejection, redirect rejection, SSH rejection, and `push` rejection.
- [ ] **Step 2:** Implement the Git HTTP adapter over the shared secure-fetch policy; preserve binary smart-HTTP request bodies and bounded response bytes.
- [ ] **Step 3:** Propagate abort, timeout, status, response-size, and allowlist failures as non-zero Git results without exposing response contents or credentials.
- [ ] **Step 4:** Keep `onAuth`, credential headers, token storage, and push transport absent from the implementation.
- [ ] **Step 5:** Run `npx vitest run plugins/workspace/tests/git.test.ts` with only mocked HTTP.

---

## Task 5: Update operator documentation and prompt

**Files:**
- Modify: `plugins/workspace/README.md`
- Modify: `plugins/workspace/src/prompt.ts`

- [ ] **Step 1:** Remove Host mode and Host approval instructions.
- [ ] **Step 2:** Document that default `/home/workspace` and `rw` mounts persist Git repositories to host-backed directories, while `ro` rejects writes and `overlay` does not write back.
- [ ] **Step 3:** Document local Git usage through `bash`, `enableNetwork`, terminal-wildcard `allowedUrlPrefixes`, public HTTPS remotes, and unsupported SSH/authentication/push behavior.
- [ ] **Step 4:** Run `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/workspace.test.ts` and confirm prompt/resource behavior remains valid.

---

## Task 6: Complete focused verification

**Files:**
- No source changes; inspect the complete change diff.

- [ ] **Step 1:** Run `npx vitest run plugins/workspace`.
- [ ] **Step 2:** Run `npx tsc --noEmit -p plugins/workspace/tsconfig.json`.
- [ ] **Step 3:** Run `openspec validate --change integrate-isomorphic-git-workspace`.
- [ ] **Step 4:** Review the final diff and confirm only planned Workspace files, package metadata, lockfile, documentation, and OpenSpec artifacts changed; preserve the root `package.json` user modification.
