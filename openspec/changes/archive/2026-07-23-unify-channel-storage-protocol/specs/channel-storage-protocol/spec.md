## ADDED Requirements

### Requirement: Canonical Channel Key Protocol

Core MUST generate one deterministic Channel Key from a versioned tagged tuple and MUST expose that generation through `YesImBotService`.

#### Scenario: Shared channel canonical input
- **WHEN** Core generates a Key for a non-direct `ChannelScope`
- **THEN** it MUST serialize `["yesimbot.channel",1,"shared",platform,null,channelId]` with compact ECMAScript `JSON.stringify`
- **AND** changing only `selfId` MUST NOT change the canonical input or Key

#### Scenario: Direct channel canonical input
- **WHEN** Core generates a Key for a direct `ChannelScope`
- **THEN** it MUST serialize `["yesimbot.channel",1,"direct",platform,selfId,channelId]` with compact ECMAScript `JSON.stringify`
- **AND** changing `selfId` MUST change the canonical input and Key except for a cryptographic hash collision

#### Scenario: Opaque identifiers retain exact bytes
- **WHEN** Core validates `platform`, `selfId`, and `channelId`
- **THEN** each field MUST be a non-empty string
- **AND** Core MUST NOT trim, case-fold, Unicode-normalize, parse, or otherwise rewrite the field

### Requirement: Channel Key Encoding

Core MUST encode the Channel Key as the lowercase, unpadded RFC 4648 Base32 representation of the first 16 bytes of the SHA-256 digest of the canonical UTF-8 bytes.

#### Scenario: Key is canonical and path-safe
- **WHEN** Core emits a Channel Key
- **THEN** it MUST contain exactly 26 characters
- **AND** it MUST match `^[a-z2-7]{25}[aeimquy4]$`
- **AND** it MUST NOT contain a visible protocol prefix or raw identity field

#### Scenario: Shared conformance vector
- **WHEN** Core hashes `["yesimbot.channel",1,"shared","onebot",null,"123456"]`
- **THEN** it MUST produce `a5vnf2ijd75c2ibyo2s5czdir4`

#### Scenario: Direct conformance vectors
- **WHEN** Core hashes `["yesimbot.channel",1,"direct","onebot","10000","123456"]`
- **THEN** it MUST produce `ymdz53gzamgvzjzrtf6vesoal4`
- **AND** `["yesimbot.channel",1,"direct","onebot","20000","123456"]` MUST produce `3fdpuhlm2tmzybzrlgxotmtmxq`

#### Scenario: Unicode conformance vector
- **WHEN** Core hashes `["yesimbot.channel",1,"shared","测试",null,"群/α"]`
- **THEN** it MUST produce `jhmjjrbkhmceyookuqyolglf7m`

### Requirement: Channel-First Storage Layout

Core MUST place every Core-managed local resource for one channel beneath `<basePath>/channels/<key>/`.

#### Scenario: Core channel directory layout
- **WHEN** Core initializes storage for a channel
- **THEN** the channel directory MUST contain the Core-owned `channel.json`
- **AND** Session storage MUST resolve beneath `sessions/`
- **AND** Asset storage MUST resolve beneath `assets/`
- **AND** registered plugin storage MUST resolve beneath its registered namespace

#### Scenario: Session storage file
- **WHEN** Core creates the Agent JSONL storage for a channel
- **THEN** it MUST use `<basePath>/channels/<key>/sessions/messages.jsonl`

### Requirement: Authoritative Channel Manifest

Core MUST treat each valid `channel.json` as the source of truth for one channel directory.

#### Scenario: Shared Manifest identity
- **WHEN** Core commits a shared channel Manifest
- **THEN** it MUST record `formatVersion`, `keyVersion`, `key`, `isDirect: false`, `platform`, `selfId: null`, and `channelId`
- **AND** it MAY record the latest non-empty channel `name`
- **AND** it MUST NOT record Koishi assignee as authoritative storage metadata

#### Scenario: Direct Manifest identity
- **WHEN** Core commits a direct channel Manifest
- **THEN** it MUST record `isDirect: true` and the real `selfId`

#### Scenario: Existing directory identity mismatch
- **WHEN** an existing Key directory has a Manifest whose canonical identity does not reproduce the directory Key
- **THEN** Core MUST reject access as a collision or integrity error
- **AND** Core MUST NOT merge, overwrite, rename, or delete that directory

### Requirement: Rebuildable Channel Catalog

Core MUST maintain `<basePath>/channels.json` as a human-readable derived index of all valid Channel Manifests.

#### Scenario: Catalog output is deterministic
- **WHEN** Core writes the Catalog
- **THEN** it MUST encode UTF-8 JSON with two-space indentation and a trailing newline
- **AND** it MUST sort records by Channel Key in ASCII order
- **AND** each record MUST contain `key`, `isDirect`, `platform`, nullable `selfId`, `channelId`, and optional `name`

#### Scenario: Catalog is missing or invalid
- **WHEN** the Catalog is missing, malformed, or inconsistent with valid Manifests
- **THEN** Core MUST rebuild it from the valid Manifests
- **AND** it MUST NOT infer identity from module data

### Requirement: Atomic Channel Creation

Core MUST make the Manifest the only commit point for Channel directory creation and updates.

#### Scenario: New channel commits atomically
- **WHEN** Core creates storage for a previously unseen channel
- **THEN** it MUST create the complete initial Manifest in a temporary directory beneath `channels/`
- **AND** it MUST atomically rename that directory to the final Key
- **AND** module code MUST NOT receive the path before the rename succeeds

#### Scenario: Catalog update fails after Manifest commit
- **WHEN** the Manifest commit succeeds and the derived Catalog write fails
- **THEN** Core MUST retain the committed Manifest
- **AND** it MUST mark or report the Catalog as needing repair
- **AND** a later retry or startup MUST rebuild the Catalog

### Requirement: Storage Namespace Registry

Core MUST require modules to register one unique namespace before resolving module storage.

#### Scenario: Namespace is valid
- **WHEN** a module registers a namespace
- **THEN** the name MUST contain 1 to 63 characters
- **AND** it MUST match `^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$`
- **AND** it MUST NOT be a Windows reserved name

#### Scenario: Namespace collides
- **WHEN** a module registers a namespace that is already active or reserved by Core
- **THEN** registration MUST fail without changing the active owner

#### Scenario: Namespace disposer runs
- **WHEN** a module invokes its namespace registration disposer
- **THEN** Core MUST release only that active registration
- **AND** Core MUST NOT delete the namespace directory or its data

### Requirement: Safe Storage Resolution

`YesImBotService.ensureStorage` MUST resolve only registered namespaces and validated relative path segments beneath the canonical channel directory.

#### Scenario: Valid storage path resolves
- **WHEN** a caller supplies a valid Scope, registered namespace, and valid path segments
- **THEN** Core MUST ensure the Channel Manifest and namespace root exist
- **AND** it MUST return a path beneath that namespace root
- **AND** it MUST NOT create the caller's final file

#### Scenario: Path traversal input is rejected
- **WHEN** a segment is empty, `.`, `..`, absolute, contains `/`, `\`, or NUL, or resolves outside the namespace root
- **THEN** Core MUST reject the request without creating or deleting data

#### Scenario: Namespace is not registered
- **WHEN** a caller resolves a namespace without an active registration
- **THEN** Core MUST reject the request

### Requirement: Module-Owned Data Lifecycle

Core MUST leave namespace contents, caches, schema migrations, and deletion policy to the owning module.

#### Scenario: Core resets a channel
- **WHEN** `YesImBotService.reset` resets a channel
- **THEN** Session MUST clear its JSONL data
- **AND** Asset MUST clear its scoped assets
- **AND** Core MUST preserve Workspace, other namespaces, the Manifest, and the Catalog record

#### Scenario: Module unloads
- **WHEN** a module unregisters or unloads
- **THEN** Core MUST preserve that module's persisted namespace data

#### Scenario: Full channel deletion is requested
- **WHEN** a caller looks for a Core channel purge operation
- **THEN** Core MUST NOT expose a generic clear, purge, or namespace lifecycle API

### Requirement: No Legacy Storage Compatibility

The channel storage protocol MUST operate only on the new channel-first layout.

#### Scenario: Legacy storage exists
- **WHEN** `channel_v2_*`, `workspace_v2_*`, `ch_v1_*`, or old JSONL data exists
- **THEN** Core MUST NOT read, migrate, map, rename, or delete it
- **AND** Core MUST NOT fall back to it when new storage is absent

#### Scenario: Unknown channel directory is discovered
- **WHEN** startup finds an invalid Key name, missing or malformed Manifest, unknown version, identity mismatch, or unregistered namespace
- **THEN** Core MUST preserve and report the data
- **AND** Core MUST NOT claim or delete it automatically
