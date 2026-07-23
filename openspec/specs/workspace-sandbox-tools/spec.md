# workspace-sandbox-tools Specification

## Purpose

Define the workspace plugin's default sandbox tools, channel-scoped workspace isolation, virtual filesystem mount policy, prompt guidance, and operator documentation requirements.
## Requirements
### Requirement: Channel-Scoped Workspace Isolation

The Workspace plugin SHALL register the `workspace` storage namespace and SHALL use the directory resolved by `YesImBotService.ensureStorage` as the default writable Workspace root.

#### Scenario: Distinct persistent channel identities use distinct workspace roots
- **WHEN** two Agent runtimes use different Core Channel Keys
- **THEN** each Runtime MUST receive a Workspace whose default writable files are isolated from the other Runtime
- **AND** each Workspace root MUST resolve beneath its Channel Key directory

#### Scenario: Same channel reuses persisted workspace
- **WHEN** an Agent runtime is recreated for the same Channel Key
- **THEN** the Workspace plugin MUST resolve the same `workspace` namespace root
- **AND** files written by a previous Runtime MUST remain available

#### Scenario: Shared channel changes assignee

- **WHEN** RuntimeManager rebuilds a shared-channel Runtime for a new Koishi assignee
- **THEN** the Workspace plugin MUST reuse the same Workspace root and cached persistent data

#### Scenario: Direct channels use bot isolation

- **WHEN** two direct scopes differ by `selfId`
- **THEN** they MUST resolve different Workspace roots

#### Scenario: Workspace root hides raw channel ids
- **WHEN** the Workspace plugin resolves a channel workspace directory
- **THEN** the directory name MUST NOT include raw `platform`, `selfId`, or `channelId`

#### Scenario: Workspace plugin does not implement channel paths
- **WHEN** the Workspace plugin needs a channel Workspace root
- **THEN** it MUST call `YesImBotService.ensureStorage` with the registered `workspace` namespace
- **AND** it MUST NOT use plugin-local target types, root configuration, channel sanitization, hash helpers, or path concatenation

#### Scenario: Workspace plugin unloads

- **WHEN** the Workspace plugin invokes its namespace disposer
- **THEN** Core and the plugin MUST preserve persisted Workspace data

### Requirement: Bash Tool Backed Default Tool Set

The workspace plugin SHALL expose `bash-tool` backed `bash`, `readFile`, and `writeFile` tools as the default workspace tool set.

#### Scenario: Default tools are registered

- **WHEN** the workspace plugin registers its agent plugin for a channel
- **THEN** the agent tool set includes `bash`, `readFile`, and `writeFile`

#### Scenario: Legacy custom tools are not default tools

- **WHEN** the workspace plugin registers its default agent tools
- **THEN** the default tool set does not require custom `grep`, `glob`, `edit_file`, `read_file`, `write_file`, or `execute_command` implementations

### Requirement: Virtual Filesystem Boundary

Workspace read, write, and command execution tools MUST operate through the configured `just-bash` virtual filesystem and MUST NOT directly read or write host paths outside explicit mounts.

#### Scenario: File tool writes use virtual filesystem

- **WHEN** an agent calls `writeFile`
- **THEN** the file is written through the workspace virtual filesystem at the resolved virtual path

#### Scenario: Bash commands see mounted namespace only

- **WHEN** an agent calls `bash`
- **THEN** the command executes with access to the configured virtual namespace rather than unrestricted host filesystem access

### Requirement: Mount Intent Configuration

The workspace plugin SHALL support high-level mount configuration for writable persistent paths, read-only paths, and copy-on-write overlay paths.

#### Scenario: Persistent mount is writable

- **WHEN** a virtual path is configured in `persistPaths`
- **THEN** reads and writes under that virtual path are backed by the configured host path

#### Scenario: Read-only mount rejects writes

- **WHEN** a virtual path is configured in `readOnlyPaths`
- **THEN** writes under that virtual path fail without modifying the host path

#### Scenario: Overlay mount does not persist writes

- **WHEN** a virtual path is configured in `overlayPaths`
- **THEN** reads come from the configured host path and writes remain copy-on-write in the virtual filesystem

### Requirement: Mount Validation

The workspace plugin MUST reject ambiguous or unsafe mount configuration before starting the workspace runtime.

#### Scenario: Duplicate mount point is rejected

- **WHEN** the same virtual path appears in more than one mount map
- **THEN** plugin startup fails with a clear configuration error

#### Scenario: Nested mount point is rejected

- **WHEN** one configured mount point is nested under another configured mount point
- **THEN** plugin startup fails with a clear configuration error

#### Scenario: Invalid virtual mount path is rejected

- **WHEN** a configured virtual mount path is relative or contains `.` or `..` path segments
- **THEN** plugin startup fails with a clear configuration error

### Requirement: Workspace System Prompt

The workspace plugin SHALL extend the agent system prompt with channel-aware workspace sandbox instructions through the structured system prompt append hook.

#### Scenario: Prompt describes sandbox policy

- **WHEN** the workspace plugin extends the system prompt
- **THEN** the prompt includes the current working directory, workspace scope, network state, command timeout, and shell state persistence behavior

#### Scenario: Prompt describes mounted paths

- **WHEN** configured mounts exist
- **THEN** the prompt identifies writable, read-only, and overlay virtual paths without exposing unnecessary host filesystem details

#### Scenario: Prompt guidance remains system input

- **WHEN** the workspace plugin appends sandbox instructions
- **THEN** those instructions MUST be appended through AI SDK system input rather than through historical message transformation

### Requirement: Workspace Documentation

The workspace plugin SHALL document default tools, Channel Key-based channel isolation, mount configuration, network behavior, and security considerations for operators.

#### Scenario: Documentation includes safe codebase inspection example
- **WHEN** an operator reads the workspace plugin documentation
- **THEN** they can find an example that mounts a project directory read-only or copy-on-write for inspection

#### Scenario: Documentation warns about writable host mounts
- **WHEN** an operator reads the workspace plugin documentation
- **THEN** writable host-backed mounts are described as high-trust configuration suitable only for trusted channels or operators

#### Scenario: Documentation avoids raw channel path promises
- **WHEN** an operator reads channel isolation documentation
- **THEN** it MUST describe isolation by canonical Channel Key
- **AND** it MUST NOT document raw `platform:selfId:channelId` or sanitized raw IDs as directory names

