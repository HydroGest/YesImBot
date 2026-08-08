## MODIFIED Requirements

### Requirement: Bash Tool Backed Default Tool Set
Workspace SHALL expose the `bash-tool`-backed `bash`, `readFile`, and `writeFile` tools as its default Sandbox tool set. Sandbox mode SHALL remain the default mode, and Workspace SHALL NOT expose a dedicated Git or `host-exec` tool.

#### Scenario: Default tools are registered
- **WHEN** the Workspace Agent plugin initializes in Sandbox mode
- **THEN** its tool set SHALL include exactly `bash`, `readFile`, and `writeFile` as the Workspace tools

#### Scenario: Git exposure is absent
- **WHEN** the Workspace Sandbox tool set is assembled
- **THEN** it SHALL not include a `git` tool, `host-exec`, or a separate host command schema

#### Scenario: Host reuses the same shell
- **WHEN** an allowed Host Runtime initializes
- **THEN** it SHALL use the same three bash-tool contracts rather than adding a second tool set

### Requirement: Virtual Filesystem Boundary
Workspace Sandbox tools MUST operate through the configured `just-bash` virtual filesystem and MUST NOT directly access unmounted host paths. Host mode is a separate backend and is not governed by this Sandbox boundary.

#### Scenario: A mounted path is written
- **WHEN** an agent writes through Sandbox `writeFile`
- **THEN** the virtual filesystem SHALL apply the configured writable, read-only, or overlay mount policy

#### Scenario: An unmounted host path is requested
- **WHEN** a Sandbox command or file tool attempts to access a host path that is not represented by a declared or implicit virtual mount
- **THEN** the virtual filesystem SHALL deny the access

## ADDED Requirements

### Requirement: Single normalized Sandbox mount declarations
Sandbox SHALL accept one mount declaration list with `source`, `target`, and `mode` values of `rw`, `ro`, or `overlay`.

#### Scenario: Mounts are normalized
- **WHEN** the plugin starts
- **THEN** relative sources SHALL resolve against `ctx.baseDir`, existing sources SHALL be canonicalized, and writable missing directories SHALL be created

#### Scenario: Mount targets conflict
- **WHEN** mount targets duplicate, are `/`, overlap the reserved `/home/workspace`, or form a parent/child nesting
- **THEN** configuration SHALL be rejected without applying an override or precedence rule

### Requirement: Sandbox Git rollback
Sandbox SHALL not register or initialize the unapproved Git tool or Host temporary-mount bridge.

#### Scenario: Plugin starts after rollback
- **WHEN** Workspace starts in Sandbox mode
- **THEN** no Git tool, `enableGit` registration, `host-exec`, `hostTmpRoot`, or Git temporary mount SHALL be created
