## Context

`plugins/workspace` currently has two execution paths: the normal `just-bash` virtual filesystem and a real `/bin/bash` host runner with policy and approval infrastructure. The host path is no longer part of the approved architecture. The remaining sandbox already owns a channel-scoped `MountableFs`, the default `/home/workspace` writable mount, optional `rw`/`ro`/`overlay` mounts, and the existing `bash`, `readFile`, and `writeFile` Agent tools.

The workspace needs Git operations without invoking a host executable. `references/isomorphic-git` contains the implementation reference but is source-only and has no publishable package entry point. The runtime dependency will therefore be the registry package `isomorphic-git`, loaded lazily. The existing `references/isomorphic-git` directory is not copied, bundled, or used as a `file:` dependency.

## Goals / Non-Goals

**Goals:**

- Make sandbox execution the only Workspace Bash backend and remove the host-mode attack surface and maintenance cost.
- Keep all existing sandbox mount, channel isolation, resource reader, skill, timeout, and tool contracts.
- Make `git ...` available through the existing Bash tool as one lazy custom command.
- Keep local Git state inside the current virtual filesystem and preserve normal mount persistence semantics.
- Support public HTTPS clone/fetch/pull while enforcing `enableNetwork`, a wildcard-aware allowlist, HTTP method limits, redirects, timeouts, response limits, and private-range rejection.
- Add focused tests for Git filesystem behavior, persistence semantics, and network admission.

**Non-Goals:**

- No real host Bash or host approval broker.
- No `host-exec` tool, dedicated Git AgentTool set, or copied `references/computer` Git facade.
- No SSH transport, credentials, token storage, custom authentication headers, or authenticated `push`.
- No arbitrary `git` CLI compatibility; unsupported subcommands and options fail explicitly.
- No migration of existing files; mount-backed repositories retain their current bytes and `.git` directories.
- No change to Core channel-resource ownership or `workspace://` URI semantics.

## Decisions

### D1: Keep one sandbox backend and remove `bash.mode`

- **Choice:** `BashConfig` becomes the sandbox configuration directly. Remove the `mode` discriminator and all Host-only fields, schemas, prompt text, hooks, commands, runner state, and policy state.
- **Reason:** A mode with only one valid branch is dead configuration. Deletion makes the public schema and startup path smaller and prevents future callers from believing that real host execution remains available.
- **Migration:** Existing `mode: sandbox` values are removed from plugin configuration. The implementation does not retain a compatibility alias. Explicit `rw`, `ro`, and `overlay` mounts continue to be supported because they are sandbox filesystem mounts, not host execution.

### D2: Register Git as a lazy custom Bash command

- **Choice:** Add one internal `src/git.ts` module exporting only the command factory needed by `Workspace`. Register it in the existing `Bash({ customCommands })` construction. Load `isomorphic-git` only when the first Git command runs.
- **Reason:** Agents already know the Bash surface, and `just-bash` provides the command seam. A second AgentTool algebra would duplicate command invocation and resource boundaries.
- **Boundary:** The Git command receives the resolved `ctx.fs`, `ctx.cwd`, and abort signal. It never calls `child_process`, Node `fs`, or a host `git` executable.

### D3: Adapt `MountableFs` at the isomorphic-git seam

- **Choice:** Build a small internal PromiseFsClient object over `MountableFs`. Map the methods isomorphic-git actually consumes (`readFile`, `writeFile`, `mkdir`, `rmdir`, `stat`, `lstat`, `readdir`, `readlink`, `symlink`, and `chmod`) to the corresponding just-bash methods, including `rm` to `rmdir` and byte-preserving reads/writes.
- **Reason:** `MountableFs` is intentionally not a Node filesystem. A narrow adapter preserves the virtual boundary and avoids pretending that the two APIs are identical.
- **Invariant:** Every Git path operation is delegated to the same `ctx.fs` instance used by Bash. The adapter does not resolve paths against the process cwd or expose a second storage root.

### D4: Expose a bounded Git command subset

- **Choice:** Support `init`, `status`, `add`, `config`, `commit`, `log`, `diff`, `branch`, `checkout`, `clone`, `fetch`, and `pull`. `push`, SSH URLs, unknown subcommands, and unsupported options return a non-zero result with a concise error and perform no partial command rewrite.
- **Reason:** These operations cover repository creation, inspection, local history, branch work, and public read-oriented remote synchronization without pretending to implement all native Git behavior.
- **Commit identity:** `git config user.name <value>` and `git config user.email <value>` write repository configuration through isomorphic-git. `git commit -m <message>` uses those values according to isomorphic-git's normal commit defaults; missing identity is reported as a command failure.
- **Remote behavior:** `clone`, `fetch`, and `pull` use HTTPS and the configured allowlist. They do not receive `onAuth` callbacks or secret headers. `push` is intentionally unavailable until a separate credential boundary is approved.

### D5: Make wildcard allowlists conservative and compatible with just-bash

- **Choice:** `bash.allowedUrlPrefixes` accepts absolute `http://` or `https://` URL prefixes with an optional single terminal `*`. The terminal `*` means “any remaining URL suffix,” including nested path segments. Wildcards elsewhere are rejected during configuration normalization.
- **Examples:**
  - `https://github.com/example/*` allows all paths below that prefix.
  - `https://api.example.com/v1/*` allows `/v1/` descendants but not `/v10/`.
  - `https://*.example.com/*` is invalid because host wildcards are not part of the first version.
- **Reason:** A terminal wildcard adds the requested convenience while reducing ambiguous host matching and preserving the boundary-aware prefix semantics already implemented by just-bash.
- **Implementation:** Normalize terminal `*` away before passing the prefixes to just-bash's secure network layer. The same normalized list is used for Bash and Git. An empty list never becomes full Internet access. Git additionally requires an `https://` target.

### D6: Reuse the secure network boundary for Git HTTP

- **Choice:** Construct Git's HTTP client over just-bash's secure fetch policy rather than using isomorphic-git's default Node `simple-get` transport. Allow only `GET`, `HEAD`, and `POST`; enable private-range denial; inherit configured timeout, redirect, and response-size limits.
- **Reason:** The default Node transport would bypass the sandbox network allowlist. Reusing the existing policy keeps Bash and Git subject to one admission boundary.
- **Binary requests:** Git smart-HTTP POST bodies are collected as bytes and passed through the secure-fetch seam without UTF-8 conversion. Responses are converted to the async body shape expected by isomorphic-git. The first implementation remains bounded by the configured response-size cap; streaming is deferred until real repository sizes require it.
- **Redirects:** Each redirect is checked by the secure fetch implementation. A redirect outside the normalized allowlist fails the Git command.

### D7: Preserve mount-defined persistence

- **Choice:** Do not add a Git-specific persistence layer. Git stores `.git` and working-tree files through the existing mounts.
- **Observable behavior:** The default `/home/workspace` and explicit `rw` mounts persist to their host-backed directories. `ro` mounts reject writes. `overlay` writes stay in the virtual upper layer and do not write back. Unmounted virtual paths do not acquire host persistence.
- **Reason:** Persistence belongs to `MountableFs` and ChannelResources, not to Git. This avoids a second repository storage protocol.

### D8: Remove only host code and update the affected sandbox contract

- **Delete:** `src/host-engine.ts`, `src/host-policy.ts`, `tests/host-engine.test.ts`, and `tests/host-policy.test.ts`.
- **Modify:** `src/index.ts`, `src/types.ts`, `src/bash-tool.ts`, `src/prompt.ts`, `src/workspace.ts`, existing plugin/bash/workspace tests, package metadata, lockfile, and README.
- **Add:** `src/git.ts` and `tests/git.test.ts`.
- **Preserve:** `mounts.ts`, `skills.ts`, resource readers, channel-root resolution, and the existing three tool schemas except for the addition of the internal `git` Bash command.

## File and Interface Map

- `plugins/workspace/src/types.ts`: sandbox-only public configuration, including `enableNetwork` and `allowedUrlPrefixes`.
- `plugins/workspace/src/index.ts`: schema, plugin lifecycle, workspace cache, and resource registration; no Git protocol implementation.
- `plugins/workspace/src/workspace.ts`: pass network policy and the lazy Git custom command into `Bash`; retain all filesystem/mount construction.
- `plugins/workspace/src/git.ts`: command parsing, supported isomorphic-git API dispatch, `MountableFs` adapter, and secure Git HTTP adapter.
- `plugins/workspace/src/bash-tool.ts`: fixed sandbox wording and backend contract; no host environment branch.
- `plugins/workspace/src/prompt.ts`: sandbox prompt only, with Git and persistence guidance.
- `plugins/workspace/tests/git.test.ts`: direct command behavior plus injected/mock HTTP coverage without external network.

## Risks / Trade-offs

- A buffered secure-fetch response limits very large remote repositories. The first version favors a shared bounded security primitive over a new streaming transport; a future streaming change should be driven by observed failures.
- Public-only remote Git cannot push. This is intentional until a credential provider and redaction contract exist.
- Removing `bash.mode` is a configuration breaking change. Keeping a dead sandbox literal would preserve ambiguity without preserving host compatibility.
- A Git CLI subset is not native Git compatibility. Unsupported behavior fails explicitly instead of silently approximating it.
- `allowedUrlPrefixes` wildcard support is intentionally terminal-only. Broader host/path globbing can be added later only with a security-reviewed matcher and redirect tests.

## Migration Plan

1. Remove host-only code, tests, schema branches, and prompt text; update sandbox tests to omit `bash.mode`.
2. Add the registry `isomorphic-git` dependency and implement the `MountableFs` adapter plus lazy Git command.
3. Normalize terminal wildcard URL entries and wire the shared network policy into Bash and Git HTTP.
4. Add local Git, mount persistence, remote allowlist, network-disabled, redirect, and unsupported-command tests.
5. Update the plugin README and run focused Workspace tests and type checking before any broader validation.

Rollback is code/config rollback only: stopping or removing the Workspace plugin leaves existing mount-backed workspace files untouched. No legacy host data migration is introduced.

## Open Questions

None remain for the approved scope. Host wildcard matching, credentials, SSH, and push require a later explicit change.
