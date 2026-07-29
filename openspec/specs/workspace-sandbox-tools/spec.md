# workspace-sandbox-tools Specification

## Purpose

Define Workspace sandbox tools, channel-scoped isolation, virtual filesystem mounts, and operator documentation.

## Requirements

### Requirement: Channel-Scoped Workspace Isolation
Workspace MUST obtain the channel root through `getStoragePath(scope)` and use its `workspace/` child as the writable-root path. Its in-memory cache MUST use shared `[platform, channelId]` and direct `[platform, selfId, channelId]` semantics.

#### Scenario: Workspace is resolved
- **WHEN** a runtime requests its workspace
- **THEN** the plugin MUST create `workspace/` under the returned root and MUST NOT construct the channel directory protocol

#### Scenario: Shared Bot replacement
- **WHEN** a shared scope is created for a different current Bot
- **THEN** Workspace MUST reuse the same root and cache entry
### Requirement: Bash Tool Backed Default Tool Set
Workspace SHALL expose `bash-tool` backed `bash`, `readFile`, and `writeFile` as its default tool set.

#### Scenario: Default tools are registered
- **WHEN** the Workspace Agent plugin initializes
- **THEN** its tool set MUST include `bash`, `readFile`, and `writeFile`

### Requirement: Virtual Filesystem Boundary
Workspace tools MUST operate through the configured `just-bash` virtual filesystem and MUST NOT directly access unmounted host paths.

#### Scenario: A mounted path is written
- **WHEN** an agent writes through `writeFile`
- **THEN** the virtual filesystem MUST apply the configured writable, read-only, or overlay mount policy

### Requirement: Workspace Documentation
Workspace documentation SHALL describe Core-resolved readable storage, default tools, mount safety, and channel isolation without claiming that the plugin derives directory names.

#### Scenario: Operator reads isolation documentation
- **WHEN** an operator reads Workspace documentation
- **THEN** it MUST identify `getStoragePath(scope)` as the channel-root boundary
