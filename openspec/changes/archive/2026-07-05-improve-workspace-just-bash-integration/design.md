## Context

`koishi-plugin-yesimbot-workspace` currently implements its own agent-facing
workspace tools on top of `just-bash`. The plugin already uses the right core
building blocks: `Bash`, `MountableFs`, `InMemoryFs`, `OverlayFs`, and
`ReadWriteFs`. However, the custom tool layer duplicates behavior that
`bash-tool` already provides and increases maintenance and safety surface,
especially around command construction, path handling, output truncation, and
tool prompts.

Koishi also changes the workspace model: the useful boundary is not only a
single local directory, but the channel runtime identity
`platform:selfId:channelId`. A group channel should share its own workspace,
while private chats and other channels should not see or mutate each other's
files by default.

Stakeholders are Koishi bot operators, channel users interacting with the
agent, and future plugin maintainers. The design should preserve sandbox
boundaries, keep the configuration understandable, and avoid new abstractions
that are not required by the current workspace use cases.

## Goals / Non-Goals

**Goals:**

- Replace the default custom workspace tools with `bash-tool`'s lightweight
  `bash`, `readFile`, and `writeFile` tools.
- Keep `just-bash` as the default sandbox and virtual filesystem engine.
- Create channel-isolated writable workspaces by default.
- Provide clear high-level mount configuration for writable, read-only, and
  copy-on-write host-backed paths.
- Inject a system prompt that explains the sandbox, current working directory,
  mount table, network policy, timeout, and file persistence semantics.
- Fail fast on ambiguous or unsafe mount configuration.
- Document practical Koishi usage patterns and security risks.

**Non-Goals:**

- Do not implement a full `@vercel/sandbox` backend in this change.
- Do not expose raw `just-bash` filesystem classes in Koishi config.
- Do not bypass `just-bash` virtual filesystem APIs for file tools.
- Do not add background process management.
- Do not preserve every old custom tool name unless a compatibility decision is
  made during implementation planning.

## Decisions

### D1: Use `bash-tool` as the default tool layer

- **Choice:** Expose `bash`, `readFile`, and `writeFile` from `bash-tool` by
  default, backed by the plugin's `just-bash` workspace.
- **Rationale:** `bash-tool` is already designed as a lightweight agent wrapper
  for `just-bash`. It covers command execution, basic file read/write, output
  truncation, and tool descriptions without duplicating this plugin's code.
- **Alternatives considered:** Keeping `read_file`, `write_file`, `edit_file`,
  `grep`, `glob`, and `execute_command` preserves current names but keeps
  duplicated behavior and shell composition risk. Using only one `bash` tool is
  simpler, but `readFile` and `writeFile` are convenient and avoid shell calls
  for direct file operations.

### D2: Make workspaces channel-isolated by default

- **Choice:** Create workspace instances per channel runtime identity:
  `platform:selfId:channelId`.
- **Rationale:** Koishi channels are the natural collaboration and privacy
  boundary. Group members can share generated artifacts in one channel, while
  other groups and private chats remain isolated.
- **Alternatives considered:** A single global workspace is easier to implement
  but risks cross-channel data leakage. Bot-scoped workspaces may be useful for
  shared bot memory but are too broad as the default.

### D3: Keep mount configuration high-level

- **Choice:** Configure mounts through user-facing maps:
  `persistPaths`, `readOnlyPaths`, and `overlayPaths`, plus `initialFiles` as
  seed content.
- **Rationale:** Operators should express intent, not filesystem class names.
  The plugin can map intent to `ReadWriteFs`, read-only `OverlayFs`, and
  copy-on-write `OverlayFs`.
- **Alternatives considered:** Exposing raw `MountableFs` configuration would be
  more flexible but leaks implementation details and makes unsafe combinations
  easier to configure.

### D4: Fail on ambiguous mount routing

- **Choice:** Reject duplicate mount points, nested mount points, invalid
  virtual paths, and mount points appearing in more than one mount map.
- **Rationale:** Filesystem routing is security-sensitive. A startup error is
  safer than hidden precedence rules.
- **Alternatives considered:** Defining precedence such as read-only over
  writable would reduce configuration failures but make the effective sandbox
  harder to reason about.

### D5: Defer full VM integration

- **Choice:** Keep `@vercel/sandbox` out of the first implementation path and
  document it as an advanced/future backend.
- **Rationale:** Full VM execution adds authentication, lifecycle, runtime, and
  cost complexity. The current requirements are about improving the
  `just-bash` workspace plugin.
- **Alternatives considered:** Adding a backend switch now would serve heavy
  code-execution use cases, but it would expand scope and weaken the direct
  `just-bash` integration focus.

## Risks / Trade-offs

- [Risk] Existing prompts or tests may expect old tool names. → Mitigation:
  decide during planning whether to provide a compatibility alias layer or a
  documented breaking change.
- [Risk] Channel-scoped workspaces require per-channel runtime construction
  instead of a single global `Workspace`. → Mitigation: use the existing
  `registerAgentPlugin(context)` channel context to create or retrieve the
  correct workspace.
- [Risk] Writable host-backed mounts can modify trusted directories. →
  Mitigation: make them explicit, document high-trust use, and keep read-only or
  overlay examples as the safer default for project directories.
- [Risk] `bash-tool` may not expose every behavior of the previous custom tools,
  such as exact text replacement. → Mitigation: rely on `bash` tools first and
  only add a focused edit tool later if real usage shows the need.
- [Trade-off] The plugin becomes less bespoke but more dependent on `bash-tool`.
  → Accepted because `bash-tool` is small, already selected, and purpose-built
  for this layer.

## Migration Plan

1. Add tests that describe the desired tool exposure, channel isolation,
   mount validation, and prompt content.
2. Adapt `Workspace` or add a small adapter so `bash-tool` operates through the
   existing `just-bash` filesystem and Bash instance.
3. Move workspace construction from a single plugin-global instance to
   channel-scoped instances keyed by `platform:selfId:channelId`.
4. Implement strict mount normalization and conflict validation before creating
   filesystems.
5. Replace default custom tool registration with `bash-tool` tools.
6. Update documentation with configuration examples and safety notes.
7. Verify with package tests and type checks.

Rollback strategy: revert tool registration to the current custom tool set and
single workspace construction if channel-scoped `bash-tool` integration causes
runtime regressions. No database migration is involved.

## Open Questions

- Should the first implementation include compatibility aliases for old tool
  names, or make the tool rename explicit in documentation?
- Should `initialFiles` accept inline content only, host file paths only, or
  both?
- Should `overlayPaths` ship in the first implementation, or should the first
  pass support only `persistPaths` and `readOnlyPaths` while leaving the
  internal design ready for overlays?
