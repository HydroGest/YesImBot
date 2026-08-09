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

- [ ] **Step 1: Update sandbox tests to express the new public configuration**
  - Remove `mode: "sandbox"` from existing test configurations.
  - Add an assertion that a configured Workspace creates only the virtual `Workspace` backend and the existing `bash`, `readFile`, and `writeFile` tools.
  - Add an assertion that no Host approval command or Host runner is registered.

- [ ] **Step 2: Delete Host-only source and tests**
  - Delete the two Host source modules and their focused test files.
  - Do not delete `mounts.ts`, `skills.ts`, `workspace.ts`, or the default writable workspace mount; those remain sandbox behavior.

- [ ] **Step 3: Collapse the configuration and lifecycle branches**
  - In `types.ts`, make `BashConfig` the sandbox configuration and delete `HostBashConfig`, `HostChannelRule`, and `HostRootSpec`.
  - In `index.ts`, remove Host imports, fields, schema branches, admission checks, approval command registration, Host stop logic, Host backend construction, and Host helper functions.
  - Make `start()` and `setup()` construct only the sandbox path.
  - Remove the redundant `mode` field from the schema and all generated/default configuration assumptions.

- [ ] **Step 4: Simplify tool and prompt contracts**
  - Remove the `environment: "sandbox" | "host"` input from `createBashToolSet` and make its instructions sandbox-only.
  - Delete `formatHostWorkspacePrompt` and retain one sandbox prompt formatter.
  - Keep the existing `bash`, `readFile`, and `writeFile` input/output schemas and output truncation behavior unchanged.

- [ ] **Step 5: Run the focused Host-removal tests**
  - Run: `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/bash-tool.test.ts plugins/workspace/tests/workspace.test.ts`
  - Expected: all remaining sandbox tests pass and no test imports a deleted Host symbol.

---

## Task 2: Normalize the sandbox network allowlist

**Files:**
- Modify: `plugins/workspace/src/types.ts`
- Modify: `plugins/workspace/src/index.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Test: `plugins/workspace/tests/network.test.ts` (create if no existing network test exists)

**Interfaces:**

```ts
interface SandboxBashConfig {
  enableNetwork?: boolean;
  allowedUrlPrefixes?: string[];
}

function normalizeAllowedUrlPrefixes(entries: readonly string[]): string[];
```

- [ ] **Step 1: Add failing allowlist tests**
  - Verify absent/false `enableNetwork` creates no network capability.
  - Verify `enableNetwork: true` with no entries rejects all URLs.
  - Verify `https://github.com/example/*` matches nested paths below that prefix.
  - Verify the prefix boundary does not treat `/v1/*` as matching `/v10/`.
  - Verify wildcard placement in the scheme, host, or middle of a path is rejected.
  - Verify non-HTTP(S), credentials, query, and fragment-bearing allowlist patterns are rejected if the just-bash network contract rejects them.

- [ ] **Step 2: Implement normalization at the configuration boundary**
  - Add `allowedUrlPrefixes` as a string-array schema field with an empty-array default.
  - Require at most one `*`, and only as the final character.
  - Validate the remaining string as an absolute HTTP(S) URL prefix accepted by just-bash.
  - Remove the terminal `*` before passing the entry to just-bash, because the secure fetch prefix check already represents the intended “any suffix” behavior.
  - Never convert an empty allowlist into `dangerouslyAllowFullInternetAccess`.

- [ ] **Step 3: Wire the shared network policy**
  - Pass `undefined` when `enableNetwork` is false.
  - When enabled, pass `allowedUrlPrefixes`, `allowedMethods: ["GET", "HEAD", "POST"]`, `denyPrivateRanges: true`, and the existing timeout/response limits to just-bash.
  - Keep Bash curl/wget and the future Git HTTP adapter on the same normalized policy.

- [ ] **Step 4: Run the focused network tests**
  - Run: `npx vitest run plugins/workspace/tests/network.test.ts`
  - Expected: wildcard, boundary, deny-by-default, and invalid-config cases pass without external network access.

---

## Task 3: Add the virtual-filesystem Git command

**Files:**
- Modify: `plugins/workspace/package.json`
- Modify: `yarn.lock`
- Create: `plugins/workspace/src/git.ts`
- Modify: `plugins/workspace/src/workspace.ts`
- Test: `plugins/workspace/tests/git.test.ts`

**Interfaces:**

```ts
function createGitCommand(options: {
  network?: NetworkConfig;
}): CustomCommand;
```

The factory is internal. It does not export a `GitClient`, repository class, or second public tool algebra.

- [ ] **Step 1: Add failing local Git tests**
  - Create a Workspace with the default writable virtual root.
  - Execute `git init`, write a file through `Workspace.fs`, then execute `git add`, `git config user.name`, `git config user.email`, and `git commit -m ...`.
  - Assert `git status`, `git log`, `git diff`, `git branch`, and `git checkout` observe the same virtual files.
  - Assert `.git` is visible through virtual reads and is not written through Node host fs APIs.
  - Assert writes under read-only mounts fail and writes under overlays do not alter their source directory.
  - Assert unsupported `git push`, SSH URLs, and unknown options return non-zero results.

- [ ] **Step 2: Add the registry dependency**
  - Add the current compatible registry `isomorphic-git` version to `plugins/workspace/package.json`.
  - Do not use `file:../../references/isomorphic-git` because the reference directory has no distributable package entry point.
  - Update only the relevant Yarn lock entries and preserve the root `package.json` user change.

- [ ] **Step 3: Implement the narrow filesystem adapter**
  - Adapt the `MountableFs` methods required by isomorphic-git.
  - Preserve byte reads and writes; do not coerce Git pack/index/object bytes through UTF-8 strings.
  - Map directory removal to the available just-bash remove operation.
  - Preserve the stat fields and file/directory checks needed by isomorphic-git.
  - Pass virtual paths through unchanged so mount policy and channel isolation remain authoritative.

- [ ] **Step 4: Implement lazy command registration and local dispatch**
  - Register a lazy `git` custom command in the `Bash` constructor.
  - Dynamically import `isomorphic-git` only when the command is first used.
  - Dispatch only `init`, `status`, `add`, `config`, `commit`, `log`, `diff`, `branch`, and `checkout`.
  - Use `ctx.cwd` as the repository directory unless an explicitly supported command argument supplies a virtual subdirectory.
  - Return the existing custom-command result shape and honor `ctx.signal`.

- [ ] **Step 5: Run local Git tests**
  - Run: `npx vitest run plugins/workspace/tests/git.test.ts`
  - Expected: local repository creation, persistence semantics, history, branch operations, cancellation, and unsupported commands pass.

---

## Task 4: Add public HTTPS remote Git

**Files:**
- Modify: `plugins/workspace/src/git.ts`
- Test: `plugins/workspace/tests/git.test.ts`

- [ ] **Step 1: Add mock transport tests before remote implementation**
  - Stub the HTTP boundary; do not contact GitHub or another external service.
  - Assert `clone`, `fetch`, and `pull` use only allowlisted HTTPS URLs.
  - Assert false/absent `enableNetwork`, an empty allowlist, non-matching URLs, disallowed redirects, SSH URLs, and `push` fail before a transport is used.

- [ ] **Step 2: Implement the secure Git HTTP adapter**
  - Use the normalized just-bash secure-fetch policy instead of isomorphic-git's default Node HTTP module.
  - Support binary Git smart-HTTP request bodies without UTF-8 conversion.
  - Convert bounded response bytes into the async body form expected by isomorphic-git.
  - Propagate abort signals, timeout errors, HTTP status failures, response-size failures, and allowlist failures as non-zero Git results.

- [ ] **Step 3: Dispatch read-oriented remote operations**
  - Implement `clone`, `fetch`, and `pull` with public HTTPS remotes.
  - Do not provide `onAuth`, credential headers, token storage, or push transport.
  - Ensure all files and `.git` metadata are materialized under the current `MountableFs`.

- [ ] **Step 4: Run remote Git tests**
  - Run: `npx vitest run plugins/workspace/tests/git.test.ts`
  - Expected: all remote cases pass using only the mock transport.

---

## Task 5: Update operator documentation and prompt

**Files:**
- Modify: `plugins/workspace/README.md`
- Modify: `plugins/workspace/src/prompt.ts`

- [ ] **Step 1: Document the sandbox-only boundary**
  - Remove Host mode and Host approval instructions.
  - Explain that explicit writable mounts may persist files to host-backed directories without enabling arbitrary host execution.

- [ ] **Step 2: Document Git and network policy**
  - Show local Git usage through `bash`.
  - Show `enableNetwork: true` together with `allowedUrlPrefixes`.
  - Document terminal `*`, public HTTPS-only remote support, and unsupported SSH/authentication/push behavior.

- [ ] **Step 3: Run documentation-facing plugin tests**
  - Run: `npx vitest run plugins/workspace/tests/plugin.test.ts plugins/workspace/tests/workspace.test.ts`
  - Expected: the sandbox prompt and resource registration remain valid.

---

## Task 6: Complete focused verification

**Files:**
- No source changes; inspect the complete change diff.

- [ ] **Step 1: Run the workspace test suite**
  - Run: `npx vitest run plugins/workspace`
  - Expected: all workspace tests pass without Host-only files or external network calls.

- [ ] **Step 2: Run package type checking**
  - Run: `npx tsc --noEmit -p plugins/workspace/tsconfig.json`
  - Expected: no TypeScript errors, including the MountableFs/isomorphic-git adapter boundary.

- [ ] **Step 3: Validate the OpenSpec change**
  - Run: `openspec validate --change integrate-isomorphic-git-workspace`
  - Expected: all required artifacts and delta requirements validate.

- [ ] **Step 4: Review the final diff**
  - Confirm only the planned workspace source, tests, package metadata, lockfile, README, and OpenSpec artifacts changed.
  - Confirm the user-owned root `package.json` modification remains intact.
