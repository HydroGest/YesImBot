# channel-storage-protocol Specification

## Requirements

### Requirement: Channel root has a versionless Manifest
Core MUST create `channel.json` atomically before returning a channel root. A shared Manifest contains exactly `platform`, `channelId`, and `createdAt`; a direct Manifest additionally contains `selfId`.

#### Scenario: Core creates a shared channel root
- **WHEN** `getStoragePath(scope)` is first called for a shared scope
- **THEN** the Manifest omits the current Bot selfId

### Requirement: Storage path facade returns the complete channel root
`getStoragePath(scope)` MUST asynchronously create or validate the channel root and return that root. Plugins may create their own children under it.

#### Scenario: A workspace plugin requests storage
- **WHEN** it calls `getStoragePath(scope)`
- **THEN** it receives the channel root and creates its `workspace/` child itself

### Requirement: Startup scan rejects invalid storage entries
Core MUST ignore malformed, mismatched, and legacy channel entries during startup without overwriting them. It MUST retain symlink and path-containment protection when validating a channel root.

### Requirement: Reset preserves non-Core plugin data
`reset(scope)` MUST remove only `sessions/` and `assets/`, preserving `channel.json` and plugin-created children. Shared reset MUST not require assignee admission.
