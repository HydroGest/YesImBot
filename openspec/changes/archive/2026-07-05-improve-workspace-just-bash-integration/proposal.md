## Why

The workspace plugin already uses `just-bash`, but its custom tools duplicate a
lightweight wrapper that `bash-tool` already provides. This change reduces
maintenance surface, strengthens sandbox consistency, and adapts the workspace
model to Koishi's channel-based runtime boundaries.

## What Changes

**Default Agent Tools**
- From: Custom tools named `read_file`, `write_file`, `edit_file`, `grep`,
  `glob`, and `execute_command`.
- To: `bash-tool` powered `bash`, `readFile`, and `writeFile` backed by the
  plugin's `just-bash` workspace.
- Reason: Avoid duplicating `bash-tool` and reduce command/path handling risk.
- Impact: Potential tool-name migration for prompts and tests.

**Workspace Isolation**
- From: One plugin-level `Workspace` instance shared by all registered agent
  plugin contexts.
- To: Channel-scoped workspaces keyed by `platform:selfId:channelId`.
- Reason: Koishi channel context is the natural privacy and collaboration
  boundary.
- Impact: Files persist within a channel by default, not across all channels.

**Mount Semantics**
- From: `persistPaths` exists in user config while `readOnlyPaths` and
  `initialFiles` exist only in lower-level `WorkspaceConfig`.
- To: High-level mount maps describe writable persistent, read-only, and
  copy-on-write paths with strict conflict validation.
- Reason: Operators need clear filesystem intent without raw `just-bash`
  classes.
- Impact: Invalid or ambiguous mount configuration fails during startup.

**Agent Prompt**
- From: A short generic Bash sandbox note.
- To: A channel-aware workspace prompt describing sandbox semantics, cwd,
  mounts, network, timeout, and persistence behavior.
- Reason: Agents need accurate operational guidance to use tools safely.
- Impact: No runtime API break, but model behavior should become more stable.

## Capabilities

### New Capabilities

- `workspace-sandbox-tools`: Covers channel-scoped workspace creation,
  `bash-tool` backed agent tools, mount policies, sandbox prompt behavior, and
  documentation expectations for the workspace plugin.

### Modified Capabilities

- None.

## Impact

- Affected package: `plugins/workspace`.
- Affected source areas: plugin config/schema, workspace construction,
  filesystem mount setup, agent plugin registration, tool registration, prompt
  extension, tests, and README/docs.
- Dependencies: use existing `just-bash` and the already selected `bash-tool`.
  Keep `@vercel/sandbox` out of the default implementation path.
- Security: stricter mount validation and clearer writable/read-only/overlay
  semantics. Writable host mounts remain high-trust and must be documented.
