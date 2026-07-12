## MODIFIED Requirements

### Requirement: Channel-Scoped Workspace Isolation

The workspace plugin SHALL create or resolve the default writable workspace per core-provided `ChannelScopeId`.

#### Scenario: Distinct channels use distinct workspace roots
- **WHEN** two agent runtimes are created for different channel scopes
- **THEN** each runtime receives a workspace whose default writable files are isolated from the other runtime
- **AND** each workspace root MUST include that channel's `ChannelScopeId`

#### Scenario: Same channel reuses persisted workspace
- **WHEN** an agent runtime is recreated for the same channel scope
- **THEN** the workspace plugin MUST derive the same `ChannelScopeId`
- **AND** files written to the default writable workspace in a previous runtime remain available

#### Scenario: Workspace root hides raw channel ids
- **WHEN** the workspace plugin creates a channel workspace directory
- **THEN** the directory name MUST NOT include raw `platform`, `selfId`, or `channelId`

#### Scenario: Workspace plugin does not implement channel id derivation
- **WHEN** the workspace plugin needs a channel workspace directory
- **THEN** it MUST call core channel scope APIs for id generation
- **AND** it MUST NOT use plugin-local channel target types, channel sanitization, or channel hash helpers

### Requirement: Workspace Documentation

The workspace plugin SHALL document default tools, `ChannelScopeId`-based channel isolation, mount configuration, network behavior, and security considerations for operators.

#### Scenario: Documentation includes safe codebase inspection example
- **WHEN** an operator reads the workspace plugin documentation
- **THEN** they can find an example that mounts a project directory read-only or copy-on-write for inspection

#### Scenario: Documentation warns about writable host mounts
- **WHEN** an operator reads the workspace plugin documentation
- **THEN** writable host-backed mounts are described as high-trust configuration suitable only for trusted channels or operators

#### Scenario: Documentation avoids raw channel path promises
- **WHEN** an operator reads channel isolation documentation
- **THEN** it MUST describe isolation by canonical `ChannelScopeId`
- **AND** it MUST NOT document raw `platform:selfId:channelId` or sanitized raw IDs as directory names
