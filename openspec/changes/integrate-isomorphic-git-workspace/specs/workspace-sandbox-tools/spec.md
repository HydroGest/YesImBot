## MODIFIED Requirements

### Requirement: Bash Tool Backed Default Tool Set
Workspace SHALL expose the `bash-tool`-backed `bash`, `readFile`, and `writeFile` Agent tools as its default sandbox tool set. Workspace SHALL not expose a host execution backend or a separate Git AgentTool; Git SHALL be available only as a custom command inside `bash`.

#### Scenario: Default tools are registered
- **WHEN** the Workspace Agent plugin initializes for a channel
- **THEN** its Agent tool set SHALL include `bash`, `readFile`, and `writeFile`
- **AND** the `bash` execution environment SHALL be the just-bash virtual filesystem

#### Scenario: Git exposure is absent
- **WHEN** the Workspace Agent tool set is assembled
- **THEN** it SHALL not include a dedicated `git` AgentTool, `host-exec`, or a separate host command schema
- **AND** the supported Git command SHALL be reachable only through the existing `bash` tool

#### Scenario: Host reuses the same shell
- **WHEN** a caller attempts to initialize the former Host path
- **THEN** Workspace SHALL use the same sandbox shell path rather than creating a second backend
- **AND** it SHALL not initialize Host runner, policy, approval, or process state

#### Scenario: Sandbox tools are registered
- **WHEN** an Agent needs Git functionality
- **THEN** it SHALL invoke `bash` with a supported `git` command
- **AND** Workspace SHALL preserve the existing three Agent tool schemas

### Requirement: Virtual Filesystem Boundary
Workspace sandbox tools and the Git custom command MUST operate through the configured `just-bash` virtual filesystem and MUST NOT directly access unmounted host paths.

#### Scenario: A mounted path is written
- **WHEN** an Agent writes through `writeFile`, `bash`, or a Git operation
- **THEN** the virtual filesystem SHALL apply the configured writable, read-only, or overlay mount policy

#### Scenario: An unmounted host path is requested
- **WHEN** a sandbox tool or Git operation attempts to access a host path that is not represented by a declared or implicit virtual mount
- **THEN** the virtual filesystem SHALL deny or otherwise reject the access
- **AND** the plugin SHALL not open the path through Node filesystem APIs

### Requirement: Workspace configuration is sandbox-only
Workspace SHALL accept sandbox filesystem and execution settings directly under `bash` and SHALL not require or accept a `bash.mode` discriminator or Host-only fields.

#### Scenario: Sandbox configuration is loaded
- **WHEN** the plugin is configured with `bash.cwd`, mounts, timeout, Python/JavaScript settings, or network settings
- **THEN** Workspace SHALL construct the sandbox using those settings
- **AND** no host admission or approval state SHALL be initialized

#### Scenario: Network allowlist is configured
- **WHEN** `bash.allowedUrlPrefixes` contains valid URL prefixes with an optional terminal `*`
- **THEN** Workspace SHALL normalize those entries and use them for sandbox network admission and remote Git
- **AND** an empty list SHALL remain deny-by-default

### Requirement: Workspace Documentation
Workspace documentation SHALL describe the sandbox-only execution boundary, Core-resolved storage, default tools, mount safety, Git availability, URL allowlisting, and channel isolation without claiming that the plugin owns arbitrary host execution.

#### Scenario: Operator reads isolation documentation
- **WHEN** an operator reads the Workspace documentation
- **THEN** it SHALL identify `resource.get(scope)` and `ChannelResources.path` as the channel-root boundary
- **AND** it SHALL explain that Git and Bash cannot bypass the virtual filesystem

#### Scenario: Operator reads persistence documentation
- **WHEN** an operator reads the Workspace documentation
- **THEN** it SHALL explain that the default workspace and `rw` mounts persist Git repositories to their host-backed directories
- **AND** it SHALL explain that `ro` mounts reject writes and `overlay` writes do not write back

#### Scenario: Operator reads network documentation
- **WHEN** an operator enables network access
- **THEN** the documentation SHALL state that `enableNetwork` alone does not allow requests
- **AND** it SHALL show the terminal-wildcard URL allowlist format

## REMOVED Requirements

### Requirement: Sandbox Git rollback

**Reason**: Git is now an approved sandbox capability exposed through the existing Bash custom-command boundary.

**Migration**: Remove rollback-only Git absence checks and replace them with the `workspace-sandbox-git` requirements.
