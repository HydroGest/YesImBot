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

### Requirement: Channel storage does not use a global registry file
Core MUST NOT create or read `channels.json`. Legacy directory and Manifest data MUST remain in place without migration or fallback reads.

### Requirement: Channel directory limits are enforced
Core MUST reject a safe readable channel directory basename longer than 200 characters.

### Requirement: Scoped Asset Service
The public facade MUST expose `AssetService.createStore(scope)`. A Store is scoped by the channel tuple, exposes `put`, `get`, and `clear`, and its concrete implementation remains private.

#### Scenario: Store persists image bytes
- **WHEN** a Store receives bytes through `put()`
- **THEN** it MUST atomically deduplicate them under the first 32 lowercase hexadecimal characters of their SHA-256 digest
- **AND** return `h("img", { id })` containing that complete ID

#### Scenario: Store resolves an asset reference
- **WHEN** `get()` receives a 7-32 character lowercase hexadecimal ID or prefix
- **THEN** an exact ID or unique prefix MUST return the scoped bytes
- **AND** an absent or ambiguous prefix MUST reject

#### Scenario: Asset reset
- **WHEN** a scoped Store is cleared
- **THEN** only that channel's assets are removed
- **AND** old `asset_` references are not read or migrated
