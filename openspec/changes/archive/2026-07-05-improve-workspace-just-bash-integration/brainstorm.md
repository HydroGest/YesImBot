<!--
Raw capture of superpowers:brainstorming output.

This file captures the exploration and approved design direction before
implementation. design.md will reorganize this content into a structured
design document.
-->

# Brainstorm: Improve Workspace Just-Bash Integration

## Background

The `koishi-plugin-yesimbot-workspace` plugin currently builds its own workspace
tool set on top of `just-bash`. It creates a `Workspace` with a virtual
filesystem and Bash runtime, then exposes custom tools:

- `read_file`
- `write_file`
- `edit_file`
- `grep`
- `glob`
- `execute_command`

The current wrapper already uses important `just-bash` primitives:

- `Bash` for sandboxed command execution.
- `MountableFs` for a unified virtual namespace.
- `InMemoryFs` for transient files.
- `OverlayFs` for copy-on-write or read-only host-backed directories.
- `ReadWriteFs` for explicitly persisted host-backed directories.

The design goal is to reduce duplicated tool implementation, preserve sandbox
boundaries, and fit Koishi's multi-platform, multi-bot, multi-channel runtime
model.

## Key Observations

`bash-tool` is a lightweight wrapper around `just-bash` and already provides the
agent-facing tools needed for the default workspace experience:

- `bash` for command execution.
- `readFile` for reading known files.
- `writeFile` for writing complete files.

It also provides mature tool descriptions and command-discovery prompt helpers.
Using it directly avoids reimplementing command execution, output truncation,
shell working-directory handling, and basic read/write tools.

`just-bash` remains the core sandbox and filesystem implementation. The plugin
should still own the Koishi-specific workspace lifecycle, channel isolation,
mount strategy, configuration schema, and system prompt.

`@vercel/sandbox` overlaps with the execution role but targets full Linux VMs.
It is not needed for the default plugin behavior. It should remain a documented
future or optional backend, not part of the first implementation path.

## Approved Decisions

1. Use `bash-tool` as the default agent tool layer.

   The plugin should expose the `bash-tool` tools by default instead of the
   current custom tools. The default tool set should be:

   - `bash`
   - `readFile`
   - `writeFile`

   Custom `edit_file`, `grep`, and `glob` should not remain default tools.
   Search, listing, transformation, and exact edits can be performed through
   `bash` using `find`, `rg`, `grep`, `sed`, `awk`, `jq`, `yq`, `cat`, `ls`, and
   related commands.

2. Default workspace scope is channel-isolated.

   Each Koishi channel gets its own persistent writable workspace by default.
   The isolation key follows the channel runtime identity:

   ```text
   platform:selfId:channelId
   ```

   This matches Koishi's group-chat and private-chat behavior. A group channel
   naturally shares a workspace among participants in that group, while private
   chats and other channels remain isolated.

3. Keep high-level mount configuration.

   The public plugin configuration should not expose raw `ReadWriteFs`,
   `OverlayFs`, or `MountableFs` constructors. Instead, it should expose
   user-facing mount maps whose semantics are clear:

   - `persistPaths`: writable persistent host-backed mounts via `ReadWriteFs`.
   - `readOnlyPaths`: read-only host-backed mounts via read-only `OverlayFs`.
   - `overlayPaths`: copy-on-write host-backed mounts via `OverlayFs`.
   - `initialFiles`: seed files copied into the virtual filesystem during
     workspace creation.

4. Fail fast on ambiguous mount conflicts.

   Duplicate mount points, nested mount points, invalid virtual paths, and the
   same virtual path appearing in multiple mount maps should fail plugin startup
   with a clear error. The plugin should not silently choose precedence for
   security-sensitive filesystem routing.

5. Keep `just-bash` as the default execution backend.

   The first implementation should not add a full `@vercel/sandbox` backend.
   The README can describe it as a future or advanced option for use cases that
   need arbitrary binaries or full VM isolation.

6. Extend the system prompt with workspace policy.

   `bash-tool` can describe the concrete tools. The plugin should inject
   Koishi/workspace-specific instructions:

   - The agent is running in a `just-bash` virtual Bash sandbox, not a host
     shell.
   - The current working directory.
   - The workspace scope and channel isolation behavior.
   - Writable, read-only, overlay, and memory paths.
   - Network availability.
   - Bash timeout.
   - Shell state isolation between calls: `cd`, shell variables, aliases, and
     functions do not persist between `bash` calls, but filesystem changes do.
   - When to use `bash` versus `readFile` and `writeFile`.
   - The agent should verify command availability with `help` or `which` rather
     than assuming host binaries exist.

## Mount Strategy

Default namespace:

```text
/home/workspace    writable, persistent, channel-scoped default cwd
/tmp               transient in-memory scratch space
/shared            optional writable shared mount
/knowledge         optional read-only knowledge/document mount
/repo              optional read-only or overlay project mount
```

The default writable workspace host path should live under the plugin `root`,
for example:

```text
data/yesimbot/workspace/channels/<platform>-<selfId>-<channelId>/
```

The exact on-disk segment should be sanitized for host filesystem safety while
remaining stable and readable.

Mount examples:

### Personal or Private Channel Assistant

```yaml
root: data/yesimbot/workspace
cwd: /home/workspace
workspaceScope: channel
enableNetwork: false
```

Use case: private notes, generated files, small data processing tasks. Each
channel has isolated persisted files.

### Group Project Assistant

```yaml
cwd: /home/workspace
workspaceScope: channel
readOnlyPaths:
  /knowledge: data/project-docs
persistPaths:
  /shared: data/yesimbot/shared
```

Use case: group members can ask the bot to summarize shared documents and write
reports or generated artifacts. `/knowledge` is safe to inspect but cannot be
modified.

### Codebase QA Assistant

```yaml
cwd: /home/workspace
readOnlyPaths:
  /repo: /home/workspace/Athena
```

Use case: ask questions about source code and write summaries into
`/home/workspace` without allowing the agent to modify the checked-out
repository.

### Code Experiment Assistant

```yaml
cwd: /repo
overlayPaths:
  /repo: /home/workspace/Athena
persistPaths:
  /home/workspace: data/yesimbot/workspace
```

Use case: let the agent inspect and experiment with changes in `/repo` while
writes stay copy-on-write and do not affect the host checkout.

### Trusted Maintenance Channel

```yaml
cwd: /repo
persistPaths:
  /repo: /home/workspace/Athena
```

Use case: explicitly trusted bot/channel where writes to a real host directory
are intended. Documentation must warn that this should only be enabled for
trusted operators and trusted channels.

## Options Considered

### Option A: Keep Custom Tools

Pros:

- Preserves current tool names.
- Allows bespoke output shapes and edit behavior.

Cons:

- Duplicates `bash-tool` functionality.
- Requires maintaining path validation, truncation, command wrapping, and shell
  behavior.
- Current `grep` implementation risks shell argument injection through command
  string composition.

Decision: not recommended.

### Option B: Replace Default Tools with `bash-tool`

Pros:

- Uses the existing lightweight wrapper designed for agents.
- Keeps plugin code smaller and clearer.
- Reduces duplicated tool behavior.
- Aligns with `just-bash` documentation and agent guidance.

Cons:

- Changes public tool names from `execute_command/read_file/write_file` to
  `bash/readFile/writeFile`.
- Drops a dedicated exact-edit tool unless reintroduced later.

Decision: recommended and approved.

### Option C: Add `@vercel/sandbox` as a First-Class Backend Now

Pros:

- Supports full Linux binaries and VM isolation.
- Useful for heavy code execution or dependency installation.

Cons:

- Adds authentication, lifecycle, cost, runtime, and network complexity.
- Overlaps with but does not simplify the default `just-bash` plugin.
- Not necessary for current requirements.

Decision: defer. Document as a future advanced backend.

## Risks

- Tool-name migration can break prompts or tests that expect the old custom
  names.
- Channel-isolated workspaces need careful lifecycle handling because
  `registerAgentPlugin` factories receive channel context, while the current
  plugin stores one global `Workspace`.
- `bash-tool` uses a sandbox interface; the plugin must adapt `Workspace` or
  `Bash` cleanly without bypassing `just-bash` virtual filesystem semantics.
- Mount validation must be strict enough to prevent ambiguous host access but
  simple enough for Koishi users to configure.
- Writable host-backed mounts are inherently high-trust and must be clearly
  documented.

## Non-Goals

- Do not implement a full VM backend in this change.
- Do not add new dependencies beyond the already selected `bash-tool` and
  existing `just-bash` integration.
- Do not expose raw filesystem implementation classes in the Koishi config.
- Do not bypass the `just-bash` virtual filesystem for file tools.
- Do not add background process management in this change.

## Open Questions

Resolved by user:

- Default workspace scope should be channel-isolated.
- Replacing the default custom tools with `bash-tool` is acceptable.
- The mount strategy above is acceptable as the design baseline.

Remaining details for implementation planning:

- Whether to provide a compatibility alias layer for old tool names during one
  release cycle.
- Whether `initialFiles` should accept inline content only, host paths only, or
  both.
- Whether `overlayPaths` should be part of the first implementation or deferred
  behind documentation and internal structure.
