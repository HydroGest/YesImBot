# Workspace sandbox Git integration

The workspace plugin currently combines a `just-bash` sandbox with a real host-Bash mode. The approved change removes real host execution entirely and makes the sandbox the only backend. Explicit `rw`, `ro`, and `overlay` mounts remain; host persistence is still possible only through those mounts.

The Git surface stays inside the existing `bash` tool. `just-bash` custom commands make `git ...` available without adding a second AgentTool API. The command is lazy-loaded and uses the npm `isomorphic-git` package; `references/isomorphic-git` is source/API reference only because it has no distributable entry point.

Git reads and writes always pass through the channel Workspace `MountableFs`. A repository under `/home/workspace` or an explicit `rw` mount persists to that mount's host backing directory. Repositories in an overlay disappear with its upper layer, and writes in read-only mounts fail. Git cannot bypass the mounted virtual filesystem.

The approved initial command surface is `init`, `status`, `add`, `commit`, `log`, `diff`, `branch`, `checkout`, `clone`, `fetch`, and `pull`. It supports HTTPS public repositories only. SSH URLs, credentials, persisted tokens, custom request headers, and `push` are out of scope; `git push` fails explicitly instead of attempting unauthenticated delivery.

Remote Git is disabled unless `bash.enableNetwork` is true. When enabled, every remote Git URL must match the configured `bash.allowedUrlPrefixes` allowlist. Entries support `*` wildcards in the host and path portions but require an explicit `https://` scheme. Matching is anchored to the normalized URL; a wildcard never crosses a path separator unless written as `**`. Redirect destinations are validated again. The implementation reuses just-bash's network policy rather than calling isomorphic-git's Node HTTP transport directly.

The configuration keeps `enableNetwork` and gains `allowedUrlPrefixes: string[]`. An empty allowlist remains deny-by-default even when network is enabled. Git HTTP allows only `GET`, `HEAD`, and `POST`, uses the existing timeout and response-size limits, and rejects loopback/private destination ranges.

The implementation stays narrow: delete the host runner/policy and their tests; remove `bash.mode` and host-only prompt/configuration branches; add one internal Git command module and focused tests. Do not copy `references/isomorphic-git` or port the large `references/computer` Git facade.
