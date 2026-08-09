## Context

`plugins/workspace` currently creates a channel-scoped `Workspace` backed by `just-bash` and exposes the `bash-tool` `bash`, `readFile`, and `writeFile` tools. Its virtual filesystem contains the channel workspace plus configured persistent, read-only, overlay, and skill mounts. Runtime plugin resources are snapshotted when a `ChannelRuntime` is created. The Core `ChannelPluginContext` provides `scope`, `bot`, and artifacts, while Runtime remains Session-free.

The requested capability adds a real-host execution mode without changing the default Sandbox boundary. The current working tree contains uncommitted Git/Host WIP that must be classified for rollback, not silently adopted. The design is intentionally implementation-free until separately approved.

## Goals / Non-Goals

**Goals:**

- Keep Sandbox as the default and preserve its virtual-filesystem behavior.
- Select Sandbox or Host through a discriminated `bash.mode` configuration branch.
- Reuse the existing `bash-tool` tool contract rather than creating a second Agent tool set.
- Run Host commands with real Bash, real host paths, a required low-privilege identity, bounded process lifecycle, and a single global Host slot.
- Enforce Host channel allowlisting, Host root policy, AST-based risk classification, explicit human approval, notifications, and minimal audit records.
- Formalize Sandbox mounts as a single, conflict-checked declaration list.
- Remove unapproved Git and Host temporary-mount exposure from Sandbox.

**Non-Goals:**

- No implementation, source change, test change, package change, or general documentation change in this design phase.
- No container, namespace, or bwrap dependency.
- No complete shell interpreter, parser, or replacement Agent tool schema in Workspace.
- No current-channel approval Agent tool and no Runtime-held Session.
- No secret-confidentiality claim for Host mode, because Host inherits the complete process environment.
- No migration to old architectures or old storage/data formats.
- No default Host Git capability; any Git command is an ordinary Host Bash call and must be classified and approved when risky.

## Decisions

### D1: Use `bash-tool` as the stable tool shell

- **Choice:** Refactor `createBashToolSet` to accept the existing `bash-tool` `Sandbox` contract. Keep the tool names, schemas, result protocol, output truncation, and abort integration identical in both modes.
- **Reason:** The Host difference is execution backend, not an Agent-facing tool capability. This avoids duplicating command schema, registration, output, or lifecycle logic.
- **Alternatives considered:** The independent `host-engine` WIP was rejected because it duplicates protocol and lacks complete security/lifecycle controls. A dependency fork was rejected because a backend seam is smaller.
- **Constraint:** If the dependency's current string cwd prefix cannot safely represent arbitrary host paths, add the smallest structured cwd/signal seam to `Sandbox.executeCommand`; the Host backend must not parse a generated shell wrapper.

### D2: Use a discriminated `bash.mode` configuration

- **Choice:** Model configuration as common fields intersected with a union of `bash: { mode: "sandbox", ... }` and `bash: { mode: "host", ... }` using `Schema.intersect`. Missing mode defaults to Sandbox.
- **Sandbox branch:** Owns `mounts`, virtual cwd, and existing just-bash options such as network, Python, and JavaScript.
- **Host branch:** Owns `allowedChannels`, `hostRoots`, and required `identity: { uid, gid }`.
- **Reason:** Mode-specific settings cannot accidentally cross the virtual/real boundary, and the default remains backward-safe.
- **Alternatives considered:** A flat set of optional fields was rejected because Host and Sandbox concerns would be mixed. Long-term compatibility aliases for three maps were rejected to avoid maintaining two configuration algebras.

### D3: Gate Host by an allow-only channel list

- **Choice:** Use flat `platform`, `channelId`, optional `type`, and optional `selfId` fields. Exact values and `*` are supported for string fields; any complete rule matches; rule order has no meaning. Empty, invalid, incomplete, or missing Host allowlist data denies Host admission.
- **Reason:** This aligns with the current `ChannelScope` discriminant and makes the direct identity visible. It avoids the older internal `isDirect` shape and avoids serialized opaque channel keys.
- **Enforcement:** Check before registering Host tools and again in `beforeToolCall`; Sandbox ignores the Host list. Config changes affect only newly created Runtime snapshots.
- **Alternatives considered:** Ordered allow/deny rules were rejected because precedence is easy to misconfigure. Reusing the unexported `isDirect` rule was rejected because it cannot match `selfId`.

### D4: Use the real shared channel workspace as Host cwd

- **Choice:** Host cwd is the actual `getStoragePath(scope)/workspace` directory. Host lazily creates that directory but never creates `Workspace`, `MountableFs`, just-bash, virtual mounts, or `hostTmpRoot`.
- **Reason:** Sandbox and Host intentionally share the channel's persistent workspace when an operator changes modes; a second directory would silently split state.
- **Lifecycle:** Host runner state is plugin-scoped; Host processes are tracked and stopped during plugin stop/reload. Sandbox Workspace caches remain a separate Sandbox concern.
- **Alternative considered:** A separate `host-workspace` directory was rejected because it creates two uncoordinated user-visible workspaces.

### D5: Use OS identity plus separate Host roots

- **Choice:** Host requires an existing low-privilege Unix identity configured as `uid/gid`; no current-process fallback and no automatic account creation. The channel workspace is an implicit writable Host root. Additional roots are explicit `{ path, mode: "ro" | "rw" }` entries. Host roots do not use virtual `overlay`.
- **Reason:** OS permissions are a real enforcement layer; string path checks alone cannot contain arbitrary Bash. The Host mode remains real host execution while avoiding accidental administrator-level execution.
- **Path behavior:** Direct file tools canonicalize existing paths and parents, enforce root/mode boundaries, reject final symlinks and traversal, and apply a fixed file-size cap. Arbitrary Bash paths are classified conservatively but cannot be fully contained by the plugin.
- **Alternative considered:** Current-process full permissions were rejected as too weak. Container/namespace isolation was deferred because it adds deployment dependencies and changes the meaning of Host mode.

### D6: Inherit the complete environment and document the risk

- **Choice:** Pass the complete `process.env` to Host Bash. Do not add a configurable secret-filter switch.
- **Reason:** This is the selected Host compatibility behavior, but it explicitly means Host is not a confidential environment.
- **Mitigation:** Operational prompt, AST risk tags for known environment/secret reads, low-privilege identity, audit metadata without values, and explicit deployment warning. These controls do not claim to prevent unknown binaries from reading environment variables.

### D7: Use one Docker-like Sandbox mount list

- **Choice:** `MountSpec { source, target, mode: "rw" | "ro" | "overlay" }` replaces the three maps. `rw` persists, `ro` is read-only, and `overlay` writes only to a virtual upper layer. `/home/workspace` is an implicit reserved `rw` mount; `/` is invalid; duplicate and parent/child target paths are invalid; overrides and nested mounts are not supported.
- **Source rules:** Relative sources resolve against `ctx.baseDir`; writable directories may be created; read-only and overlay directories must exist; existing paths are canonicalized with `realpath`.
- **Symlink rules:** Keep just-bash `ReadWriteFs` and `OverlayFs` default `allowSymlinks: false`, including existing traversal, broken-link, and TOCTOU protections. Do not write a second virtual symlink guard.
- **Alternative considered:** Keeping three maps was rejected because mode is split across field names. Supporting both shapes was rejected because merge precedence and conflicts would become a second configuration system.

### D8: Implement Host as a `bash-tool` backend and runner

- **Choice:** Refactor `host-engine.ts` into the Host backend/runner and keep `host-policy.ts` separate. The runner invokes non-interactive `/bin/bash --noprofile --norc -c`, closes stdin, pipes stdout/stderr, preserves exit status, uses the real cwd, and uses the configured uid/gid.
- **Lifecycle:** One plugin-global process slot; queued calls include approval waits. Abort, timeout, plugin stop, and reload terminate the process group with TERM followed by KILL after a short grace period. The runner drains output while enforcing a fixed memory bound; the shared `bash-tool` output protocol remains authoritative.
- **Limits:** Reuse the existing 30 KB tool output behavior, current timeout conventions (including exit 124 for timeout), a fixed Host file-read cap, and explicit process-group cleanup. Unrecoverable platform support or identity failures close Host admission.
- **Alternative considered:** A per-channel-only slot was rejected because multiple channels could race on shared host resources. Unlimited process lifetime was rejected because tool cancellation cannot safely recover it.

### D9: Reuse `just-bash.parse()` for risk classification

- **Choice:** Import the public `parse` and AST types from the installed `just-bash` version. The parser is pure and is used only to inspect the original command before execution. A recursive walker identifies command names, literal/expanded words, statements, pipelines, redirections, assignments, substitutions, functions, loops, and background markers.
- **Classification:** Bounded low-risk read-only commands allow directly. Writes, deletion, overwrite, network, interpreters/scripts, background work, complex expansion, dynamic paths/command names, and parser-unsupported syntax require explicit approval. No ordinary command-risk hard-deny tier remains under the latest decision.
- **Fallback:** `just-bash` does not accept every valid host Bash construct (for example `select` and some process substitution). Parse failure is `parser-unsupported` and requires approval; no hand-written fallback lexer and no command rewriting are added.
- **Preconditions:** Invalid scope, roots, cwd, identity, stopped runner, input/resource limit, or inability to establish cleanup can block independently of command approval.

### D10: Use Hook interception plus an internal approval broker

- **Choice:** The Agent emits the complete risky tool call. `beforeToolCall` intercepts it before execution, creates an in-memory request, notifies the human, and awaits the broker. Approval releases the original call; rejection, expiry, cancellation, or stop blocks it. No `approve` Agent tool exists.
- **Request binding:** A fingerprint covers Scope, tool, real cwd, policy revision, and original command bytes. The request has a fixed 60-second TTL; the same fingerprint may be reused without a count cap during that window, while each execution is audited. Old requests are invalidated on plugin reload.
- **Notification:** Use `ChannelPluginContext.bot.sendMessage(scope.channelId, ...)` with request ID, risk tags, redacted summary, expiry, and administrator instructions. Do not retain a Session. If notification fails, the request remains discoverable until expiry through the operator command.
- **Operator commands:** `yesimbot.workspace.approvals`, `yesimbot.workspace.approve <requestId>`, and `yesimbot.workspace.reject <requestId>` are ordinary Koishi commands, not Agent tools. All require `session.user.authority >= 5` and are under `yesimbot.workspace.*`.
- **Alternative considered:** A current-channel reply flow was rejected because Runtime is Session-free and would require a new Gateway approval broker. An external API was deferred because the operator command is the minimal local transport.

### D11: Use an operational Host prompt

- **Choice:** The Host prompt tells the Agent that it is operating on real host Bash and the channel host workspace; to generate one complete tool call; to avoid secrets, broad paths, unbounded changes, and bypass attempts; and that the system may pause a risky call for administrator approval. It says to stop after rejection/timeout instead of altering or retrying the call.
- **Reason:** The prompt describes the actual workflow, not abstract isolation principles. The hook, OS identity, roots, timeout, and process cleanup remain the real controls.
- **Alternative considered:** A prompt saying only that virtual isolation does not apply was rejected as non-actionable.

### D12: Revert Sandbox Git exposure without restoring legacy architecture

- **Choice:** Remove the uncommitted `src/git-tool.ts`, its test, `enableGit` schema/registration, Git/`host-exec` assertions, and Host temporary mount helpers. Keep unrelated just-bash ESM/worker work. Do not move Git into Host as a default tool; it remains an ordinary command that is risky unless explicitly approved.
- **Reason:** Sandbox must expose only the existing `bash/readFile/writeFile` set, and no current WIP should widen the boundary before this design is implemented.

### D13: Keep the implementation split narrow

- **Choice:** Modify `index.ts`, `types.ts`, `mounts.ts`, `bash-tool.ts`, `workspace.ts`, and `prompt.ts`; refactor `host-engine.ts`; add `host-policy.ts`. Tests cover mounts, shared backend protocol, AST decisions, approval transitions, Host process behavior, plugin admission/snapshots/prompt, and Sandbox-only tools.
- **Reason:** This separates policy from process lifecycle without creating a third path module or a second tool algebra.

## Risks / Trade-offs

- [Risk] Complete environment inheritance can expose provider keys and other process secrets. → Mitigation: document Host as non-confidential, classify known reads, use a low-privilege identity, and never log values.
- [Risk] The just-bash AST is not equivalent to the host Bash grammar. → Mitigation: parser failures require approval; maintain a syntax corpus against `/bin/bash`; never treat parser success as isolation.
- [Risk] Arbitrary host binaries can bypass static path reasoning. → Mitigation: low-privilege uid/gid, Host roots for direct tools, approval for uncertain/risky commands, and explicit residual-risk documentation.
- [Risk] A child can daemonize or escape a process group. → Mitigation: deny no command-risk tier under the latest policy, but classify background/persistence as approval; use process groups, timeouts, TERM/KILL, and deployment-level OS controls.
- [Risk] Existing Runtime snapshots delay allowlist revocation. → Mitigation: plugin reload/Runtime replacement is the documented revocation mechanism; old Runtime behavior is explicit.
- [Risk] Approval notification delivery can fail or a non-admin user can receive it. → Mitigation: show the request as waiting for an authority-5 administrator, keep it in the broker until expiry, and expose the authority-5 `approvals` list command.
- [Trade-off] A 60-second unlimited reuse window reduces operator friction but allows repeated identical calls. → Accepted explicitly; each execution is separately audited and the global Host slot remains one.
- [Trade-off] Host runner changes the `bash-tool` dependency seam. → Accepted because structured cwd/signal is smaller and safer than duplicating tool protocol.

## Migration Plan

This change is design-only until implementation is separately approved.

1. Before implementation, remove only the identified Git/Host-temp WIP; do not touch unrelated changes, generated files, old data, or old storage architectures.
2. Add the discriminated configuration and keep the default branch Sandbox.
3. Refactor the shared bash-tool backend, then add Host runner/policy and approval commands behind Host allowlisting.
4. Run focused Workspace, parser, approval, and Host process tests on a Unix-capable environment. Host must fail closed when its required identity or process-group guarantees are unavailable.
5. Rollback is configuration-safe: select Sandbox or disable/stop the Workspace plugin; stop Host runners and invalidate pending approvals. Persistent workspace files remain; no migration or legacy data reader is introduced.
6. Do not expose Host mode to production channels until authority-5 approval commands, audit behavior, low-privilege identity, and process cleanup are verified.

## Open Questions

- The exact `bash-tool` version/API change needed to pass structured cwd and signal must be verified before implementation; if the current dependency can safely quote the destination, no dependency change should be made.
- The fixed Host single-file read cap and runner hard output buffer need a concrete constant before implementation; they are intentionally not user-configurable.
- Unix process-group and `uid/gid` behavior must be verified on supported deployment platforms; unsupported platforms must leave Host unavailable.
- The redaction algorithm for approval summaries needs focused tests to ensure sensitive arguments never enter notifications or logs.
- The parser compatibility corpus should be expanded before classifying parser success as direct allow for any command family.
