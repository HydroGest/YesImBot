# channel-scope-identity Specification

## Purpose
TBD - created by archiving change unify-channel-scope-identity. Update Purpose after archive.
## Requirements
### Requirement: Channel Scope Type

Core MUST expose `ChannelScope` as the shared value object for channel-level isolation across core and optional plugins.

#### Scenario: Channel scope contains platform coordinates
- **WHEN** code constructs a channel scope from Koishi session data
- **THEN** the scope MUST contain `platform`, `selfId`, and `channelId`
- **AND** the scope MUST NOT include channel type, author id, message id, guild id, thread id, or plugin-specific fields

#### Scenario: Plugins consume the shared type
- **WHEN** workspace, MemOS, or another plugin needs a channel-level isolation boundary
- **THEN** it MUST use the core-provided `ChannelScope` shape instead of defining an equivalent plugin-local target type

### Requirement: Channel Scope ID Generation

Core MUST expose deterministic `ChannelScopeId` generation for channel scopes, and generated IDs MUST use the format `ch_v1_<16-char-hash>`.

#### Scenario: Same scope generates same id
- **WHEN** two processes generate a `ChannelScopeId` for the same `platform`, `selfId`, and `channelId`
- **THEN** both processes MUST produce the same id

#### Scenario: Different scope generates different id
- **WHEN** two channel scopes differ by `platform`, `selfId`, or `channelId`
- **THEN** their generated IDs MUST be different except for cryptographic hash collision

#### Scenario: ID is path-safe and irreversible
- **WHEN** a `ChannelScopeId` is generated
- **THEN** it MUST be safe to use as a directory or filename segment
- **AND** it MUST NOT expose raw `selfId` or `channelId`

#### Scenario: Hash length is fixed
- **WHEN** a `ChannelScopeId` is generated
- **THEN** the portion after `ch_v1_` MUST contain exactly 16 lowercase base32 characters

### Requirement: Channel Scope Metadata Records

Core MUST persist channel scope metadata so a known `ChannelScopeId` can be resolved back to its `ChannelScope` when the metadata file exists.

#### Scenario: Ensure record creates metadata
- **WHEN** core ensures a channel scope record for a scope
- **THEN** it MUST write `scope.json` under that channel's directory
- **AND** the record MUST include `version`, `id`, `scope`, and `createdAt`

#### Scenario: Resolve id from metadata
- **WHEN** code resolves an existing `ChannelScopeId`
- **THEN** core MUST read the corresponding `scope.json`
- **AND** return the stored `ChannelScope`

#### Scenario: Missing metadata is explicit
- **WHEN** code resolves a `ChannelScopeId` whose metadata file does not exist
- **THEN** core MUST return an explicit not-found result rather than deriving raw fields from the id

### Requirement: Channel Scoped Path Construction

Core MUST provide path helpers that place channel-owned data under `channels/<ChannelScopeId>/`.

#### Scenario: Core channel path uses canonical id
- **WHEN** core constructs a path for channel-owned data under `basePath`
- **THEN** the path MUST include `channels/<ChannelScopeId>/`
- **AND** it MUST NOT include raw `platform`, `selfId`, or `channelId` in path segments

#### Scenario: Plugin data may use the same id
- **WHEN** a plugin stores channel-owned data under its own root
- **THEN** it MUST use the same `ChannelScopeId` for the channel directory segment

### Requirement: No Legacy Identity Compatibility

The channel scope identity capability MUST NOT preserve legacy channel target names, legacy path formats, legacy workspace IDs, or legacy MemOS channel hashes.

#### Scenario: Old data exists
- **WHEN** old experimental session files, workspace directories, or MemOS identities exist
- **THEN** the new channel scope identity APIs MUST NOT be required to read, migrate, alias, or preserve them

