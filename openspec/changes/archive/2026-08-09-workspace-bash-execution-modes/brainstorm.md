# Brainstorm capture: Workspace Bash execution modes

## Background

`plugins/workspace` currently builds a per-channel `Workspace` backed by `just-bash`, `MountableFs`, and the `bash-tool` `Sandbox` contract. The existing tool surface is `bash`, `readFile`, and `writeFile`. Sandbox state is channel-scoped and its virtual filesystem is assembled from the channel workspace, configured mounts, and skill mounts.

The requested change is a design-only addition of a selectable Host Bash mode while preserving Sandbox as the default. Host mode must use a real host Bash process and real host paths, but it must not initialize or disguise the Workspace virtual filesystem. The working tree also contains uncommitted Git/Host WIP. The design must identify that rollback scope without editing it.

## Decision chain

### Q1 — Should Host define a second tool set?

Options considered:

- Keep the current independent `host-engine` WIP with its own schemas and output protocol.
- Fork or extend `bash-tool` into a host-specific package.
- Reuse the existing `bash-tool` shell and implement Host as another backend for its `Sandbox` interface.

Decision: reuse `bash-tool`.

The Host backend must implement the existing `executeCommand`, `readFile`, and `writeFiles` contract. Both modes therefore retain the same `bash/readFile/writeFile` names, schemas, execution protocol, output truncation, and Agent lifecycle. No `host-exec` or dedicated Git tool is introduced. If the dependency's string cwd prefix is unsafe for arbitrary host paths, the smallest dependency seam is structured cwd/signal input to `Sandbox.executeCommand`; the Host backend must not parse a generated `cd \"...\" && ...` wrapper.

### Q2 — What configuration shape distinguishes the modes?

Decision: use a discriminated `bash.mode` union aggregated with common configuration through `Schema.intersect`.

The Sandbox branch owns virtual cwd, `mounts`, and existing just-bash options such as network, Python, and JavaScript. The Host branch owns `allowedChannels`, `hostRoots`, and a required low-privilege identity. The default is `bash.mode = \"sandbox\"`; missing, empty, or invalid Host admission data is deny-by-default. The two branches do not maintain aliases for the old three-map mount shape.

### Q3 — How is Host channel admission represented?

Decision: use flat fields aligned with `ChannelScope`:

- `platform: string | \"*\"`
- `channelId: string | \"*\"`
- optional `type: \"shared\" | \"direct\"`
- optional `selfId: string | \"*\"`

Rules are allow-only and unordered: any complete match allows the channel. Wildcards are only supported for string fields. Missing Scope data cannot satisfy a rule that declares that field. The old `isDirect` field is not used. The check happens before Host tool registration and again in `beforeToolCall`. Sandbox is unaffected. Configuration changes affect only new Runtime snapshots.

### Q4 — What is the Host working directory?

Decision: use the actual `getStoragePath(scope)/workspace` directory. Sandbox and Host therefore share the channel's persistent workspace data when the mode is deliberately switched. Host mode creates only this real directory; it does not create `Workspace`, `MountableFs`, `just-bash`, temporary virtual mounts, or `hostTmpRoot`.

### Q5 — What is the actual Host permission boundary?

Decision: run Host processes under a required existing low-privilege Unix identity, configured as `host.identity = { uid, gid }`. The plugin never creates the account and never falls back to the Koishi process identity. Supplementary groups are cleared where supported. If the identity cannot be used, Host tools are unavailable.

Host path policy is separate from Sandbox mounts. The channel workspace is implicitly a writable Host root; extra `hostRoots` are explicit `{ path, mode: \"ro\" | \"rw\" }` entries. Host roots do not use virtual overlays. OS permissions are the real boundary; lexical path checks alone are not presented as complete isolation.

### Q6 — How are environment variables inherited?

Decision: inherit the complete `process.env`. This is deliberately high risk. The Host prompt and audit design must not claim credential confidentiality. Known secret-reading commands may be classified as risky, but unknown binaries can still read environment variables. This is a documented residual risk rather than a hidden filtering policy.

### Q7 — How are Sandbox mounts declared?

Decision: replace the three public maps with one Docker-like list:

```ts
interface MountSpec {
  source: string;
  target: string;
  mode: "rw" | "ro" | "overlay";
}
```

`rw` persists writes to the host source. `ro` exposes a read-only source. `overlay` exposes a read-only lower source and keeps writes in the virtual upper layer. The implicit channel workspace remains reserved at `/home/workspace`; `/` is invalid; duplicate and parent/child targets are invalid; no mount overrides another and no nested mounts are supported. Skill directories remain internal read-only mounts.

Relative sources resolve against `ctx.baseDir`. Writable sources may be created; read-only and overlay sources must already be directories. Existing sources are canonicalized with `realpath`. just-bash `ReadWriteFs` and `OverlayFs` keep their default `allowSymlinks: false` behavior and existing traversal/TOCTOU protections. Host mode never parses this list.

### Q8 — What does an approval interaction look like?

The Agent does not call an approval tool. It first emits the complete risky tool call. `AgentPlugin.beforeToolCall` receives it before execution, classifies it, and if risky calls an internal approval broker. The broker sends a request notification, waits, and returns approved/rejected/expired. Approval releases the original call; rejection or timeout blocks it. The Agent must not rewrite or split the call to bypass a decision.

The broker request is memory-only, bound to Scope, tool, cwd, policy revision, and fingerprint. It has a fixed 60-second lifetime. The same fingerprint may be reused without a count cap during that window, with each actual execution audited. Plugin stop, abort, and reload invalidate pending requests.

The approved notification path is an out-of-band Bot message to the originating channel using the `ChannelPluginContext.bot` and `scope.channelId`; no `Session` is retained in Runtime. The message contains a request ID, risk tags, a redacted summary, expiry, and instructions for an administrator. Koishi commands `yesimbot.workspace.approvals`, `yesimbot.workspace.approve <requestId>`, and `yesimbot.workspace.reject <requestId>` are not Agent tools. All require the existing Koishi authority level 5 and belong to `yesimbot.workspace.*`.

### Q9 — How are risky shell commands classified?

Decision: reuse the public `parse()` export and AST types from the installed `just-bash@3.2.0`. The parser is pure and does not execute commands or initialize a virtual filesystem. The classifier recursively walks statements, pipelines, simple/compound commands, substitutions, redirections, assignments, functions, loops, and background markers.

The AST is not treated as a complete host-Bash parser. Valid host constructs such as `select` and process substitution can fail in the current parser. Parse failure is therefore tagged `parser-unsupported` and requires explicit approval; it does not become an automatic allow. No second hand-written lexer is added and no command is rewritten. AST data generates risk tags and a redacted summary; the executed command remains the original input.

The latest policy is:

- ordinary, bounded, low-risk read-only commands: `allow`;
- writes, deletion, overwrite, network, interpreters, scripts, background work, complex expansion, or uncertain/unsupported syntax: explicit `approve`;
- no ordinary command-risk hard-deny tier;
- malformed input, invalid channel/root/cwd, missing low-privilege identity, stopped runner, resource limit, or inability to establish process cleanup remain execution preconditions that block regardless of approval.

A fingerprint is a digest of Scope, tool name, real cwd, policy revision, and the original command bytes. It prevents approval of one request from releasing a different request; it is not an authentication mechanism.

### Q10 — What Host prompt should the model receive?

The prompt must be operational rather than theoretical. It states that the current mode uses real host Bash and the channel host workspace, instructs the Agent to generate one complete tool call, avoid sensitive files and broad unbounded changes, and explains that `beforeToolCall` may pause the call for administrator approval. It must not claim that a nonexistent approval tool exists, and it must not merely say that virtual isolation rules do not apply.

The prompt explicitly says that rejection/timeout means stop, not retry with altered syntax, and that the Agent must not output sensitive command parameters, environment values, or file contents in its report.

### Q11 — What Sandbox Git changes are reverted?

The uncommitted `src/git-tool.ts` and `tests/git-tool.test.ts` are removed. `enableGit`, its schema and registration, and Git-related test expectations are removed. Sandbox tool assertions return to exactly `bash`, `readFile`, and `writeFile`. Host temporary mounts (`hostTmpRoot`, `resolveTempMount`, and related disposal) are removed. The independent `host-engine` tool set is not retained; it is redesigned as the `bash-tool Sandbox` backend. Unrelated just-bash ESM/worker changes are not reverted. No old storage architecture or data format is restored.

### Q12 — What files and tests are needed?

The minimal split is:

- `src/index.ts`: mode Schema, factory, Host admission;
- `src/types.ts`: branch and mount types;
- `src/mounts.ts`: list normalization and conflicts;
- `src/bash-tool.ts`: shared tool construction;
- `src/host-engine.ts`: Host backend, process runner, lifecycle;
- `src/host-policy.ts`: allowlist, host roots, AST classification, fingerprint, broker;
- `src/prompt.ts`: operational Host prompt;
- `src/workspace.ts`: Sandbox-only lifecycle.

Tests cover mount normalization, shared backend schema/results, AST risk decisions and approval transitions, real Host cwd/env/exit/timeout/process-group/output behavior, plugin admission/snapshots/prompt, and Sandbox-only tool exposure. No implementation or verification command is run as part of this design record.

## Trade-offs and residual risks

- Full environment inheritance is incompatible with a strong secret-confidentiality claim.
- A real Bash process can invoke arbitrary host binaries; static AST classification is advisory until approval and cannot prove arbitrary program behavior.
- A low-privilege UID/GID and roots policy are stronger than prompts but are not a container or namespace boundary.
- Process groups handle ordinary descendants, not every deliberate daemonization technique.
- Only new Runtime snapshots see configuration changes, so revocation is delayed for old Runtime instances.
- Out-of-band approval notification can fail; the request remains discoverable by authority-5 `approvals` and expires closed.
- Host mode is intentionally high-risk and must be deployed only where the operator accepts these limits.

## Scope boundary

This is a design record only. It does not modify Workspace source, configuration, tests, package metadata, generated files, or runtime behavior. The OpenSpec record must be approved before any implementation change is attempted.
