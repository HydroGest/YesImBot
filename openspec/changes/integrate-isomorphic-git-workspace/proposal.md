## Why

The workspace plugin currently carries a large real-host Bash backend, policy engine, approval broker, and mode-specific configuration even though the approved runtime boundary is the `just-bash` sandbox. At the same time, agents have no Git capability inside that sandbox. Removing host execution and integrating isomorphic-git through the existing Bash command surface reduces the plugin's attack surface and makes repository state usable without allowing arbitrary host paths.

## What Changes

- Remove the real-host Bash mode, host runner, host policy, host approval commands, host-only configuration, host prompt, and host-only tests.
- Remove the redundant `bash.mode` discriminator; sandbox becomes the only Bash backend.
- Add npm `isomorphic-git` as a workspace-plugin dependency. Use `references/isomorphic-git` only as an API/source reference; do not copy or publish that directory.
- Register a lazy `git` custom command inside the existing `bash` tool. Git reads and writes use the current `just-bash` `MountableFs`.
- Support local `init`, `status`, `add`, `commit`, `log`, `diff`, `branch`, and `checkout`, plus public HTTPS `clone`, `fetch`, and `pull`.
- Keep `push`, SSH URLs, credential persistence, and authenticated remote operations out of scope.
- Add `bash.allowedUrlPrefixes` with anchored URL wildcard matching. Remote Git is allowed only when `enableNetwork` is true and the URL matches the allowlist; an empty allowlist remains deny-by-default.
- Reuse the sandbox network security boundary for Git HTTP requests, including method, redirect, timeout, response-size, and private-range checks.
- Document that default and `rw` mounts persist Git repositories to their host-backed directories, while `ro` and `overlay` mounts retain their existing semantics.

## Capabilities

### New Capabilities

- `workspace-sandbox-git`: Git commands backed by isomorphic-git and the sandbox filesystem, including allowlisted public HTTPS remotes.

### Modified Capabilities

- `workspace-sandbox-tools`: Sandbox-only execution, simplified configuration, shared network allowlist, and Git command registration.
- `workspace-host-bash`: All host-mode requirements are removed because the plugin no longer executes real host Bash.

## Impact

Affected source includes `plugins/workspace/src/index.ts`, `types.ts`, `bash-tool.ts`, `prompt.ts`, and `workspace.ts`; a focused `src/git.ts` module and Git tests will be added. `host-engine.ts`, `host-policy.ts`, and their tests will be deleted. The plugin package and `yarn.lock` gain the registry `isomorphic-git` dependency. Existing channel resource resolution, mount normalization, skill readers, and virtual workspace persistence remain unchanged. The root `package.json` user modification is not part of this change.
