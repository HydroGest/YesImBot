# koishi-plugin-yesimbot-workspace

Workspace tools for YesImBot agents, backed by `just-bash` and `bash-tool`.

## What It Provides

- `bash`: run supported Unix-style commands in a `just-bash` virtual sandbox.
- `readFile`: read a known file from the virtual workspace.
- `writeFile`: write a complete file into the virtual workspace.

The default writable workspace is channel-isolated. The workspace plugin calls
`YesImBotService.getStoragePath(scope)` and creates its `workspace/` child
under the returned channel root. Shared scopes use `platform + channelId`;
direct scopes also include `selfId`.

This plugin no longer exposes the previous default tool names
`grep`, `glob`, `edit_file`, `read_file`, `write_file`, or `execute_command`.
There is no compatibility alias layer. Update operator expectations and any
tool-name-specific prompts to use `bash`, `readFile`, and `writeFile`.

## Configuration

| Option          | Meaning                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `cwd`           | Virtual working directory used by `bash-tool`. Default: `/home/workspace`.                              |
| `persistPaths`  | Extra writable host-backed mounts. Changes persist on the host.                                         |
| `readOnlyPaths` | Read-only host-backed mounts. Reads succeed, writes fail.                                               |
| `overlayPaths`  | Copy-on-write host-backed mounts. Reads come from the host path, writes stay in the virtual filesystem. |
| `timeoutMs`     | Bash command timeout in milliseconds. Default: `30000`.                                                 |
| `enableNetwork` | Enables `just-bash` network support. Default: `false`.                                                  |

The default
writable workspace root is resolved through the Core channel root. The plugin
does not derive a directory path and no longer accepts a plugin-local `root`
option.

## Examples

### Private or group channel workspace

```yaml
cwd: /home/workspace
enableNetwork: false
```

Every Koishi channel gets its own writable `/home/workspace`. Recreating the
runtime for the same Core channel identity reuses that channel's files.

### Group project assistant

```yaml
cwd: /home/workspace
readOnlyPaths:
  /knowledge: data/project-docs
persistPaths:
  /shared: data/yesimbot/shared
```

Use `/knowledge` for shared reference material and `/shared` only when the
channel is trusted to write back into the host-backed directory. The default
workspace resolves through the Core channel namespace and does not need a
separate root.

### Safe codebase inspection

```yaml
cwd: /home/workspace
readOnlyPaths:
  /repo: /home/workspace/Athena
```

This is the safer default for letting an agent inspect a repository without
changing host files.

### Code experiments without host writes

```yaml
cwd: /repo
overlayPaths:
  /repo: /home/workspace/Athena
```

The agent reads the real repository through `/repo`, but edits remain virtual
and do not persist back to the host path.

### Trusted maintenance channel

```yaml
cwd: /repo
persistPaths:
  /repo: /home/workspace/Athena
```

Use writable host-backed mounts only for trusted operators and trusted
channels. The agent can modify real host files under these mounts.

## Sandbox Notes

`just-bash` is a virtual Bash interpreter, not the host shell. The plugin uses
it as the default sandbox backend today.

Shell state such as `cd`, aliases, shell functions, and exported variables does
not persist between `bash` calls. Filesystem changes do persist inside the
channel workspace and any configured persistent mounts.

Network access is disabled by default. When `enableNetwork: true` is set, the
plugin passes network support through to `just-bash`, so supported commands
such as `curl` may become available inside the sandbox.

Commands run with the configured `timeoutMs`. When a command exceeds the limit,
the tool returns a timeout error instead of continuing to run in the
background.

Mounted virtual paths must be explicit and non-overlapping. The plugin rejects
duplicate mount points, nested mount points, relative paths, and paths
containing `.` or `..`.

`@vercel/sandbox` is not the default backend for this plugin. Treat it as an
advanced or future full-VM direction for cases that need arbitrary binaries or
stronger VM isolation than the current `just-bash` integration.
