# workspace-sandbox-tools Specification

## Purpose

Define Workspace sandbox tools, identity-safe channel isolation, virtual filesystem mounts, and operator documentation.

## Requirements

### Requirement: Channel-Scoped Workspace Isolation
Workspace MUST register the `workspace` namespace, use `channelIdentity(scope)` only as its in-memory cache key, and use `ensureStorage(scope, "workspace")` as its sole writable-root path source.

#### Scenario: Workspace is resolved
- **WHEN** a runtime requests its workspace
- **THEN** Core MAY expose readable raw channel coordinates in the resolved v1 directory, while the plugin MUST neither construct nor derive that directory protocol

#### Scenario: Shared assignee changes
- **WHEN** RuntimeManager rebuilds a shared runtime for another assignee
- **THEN** Workspace MUST reuse the same namespace root and cache identity

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
- **THEN** it MUST identify `ensureStorage` as the path boundary and `channelIdentity` as the logical identity
