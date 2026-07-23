## ADDED Requirements

### Requirement: Direct And Shared Channel Classification

Core MUST classify each `ChannelScope` as direct or shared before generating a Channel Key or resolving channel storage.

#### Scenario: Session creates a direct scope
- **WHEN** Gateway creates a scope from a Session whose `session.isDirect` is true
- **THEN** the scope MUST set `isDirect` to true

#### Scenario: Session creates a shared scope
- **WHEN** Gateway creates a scope from a Session whose `session.isDirect` is false
- **THEN** the scope MUST set `isDirect` to false

#### Scenario: Resolver classification disagrees
- **WHEN** a Resolver returns an EventRecord whose `channel.type` direct classification differs from the source Session
- **THEN** Gateway MUST reject the EventRecord as invalid

## MODIFIED Requirements

### Requirement: Channel Scope Type

Core MUST expose `ChannelScope` as the shared value object for channel-level execution coordinates across Core and optional plugins.

#### Scenario: Channel scope contains platform coordinates
- **WHEN** code constructs a channel scope from Koishi Session or sealed EventRecord data
- **THEN** the scope MUST contain `platform`, `selfId`, `channelId`, and `isDirect`
- **AND** the scope MUST NOT include author id, message id, guild id, thread id, display name, assignee, or plugin-specific fields

#### Scenario: Plugins consume the shared type
- **WHEN** Workspace, MemOS, or another plugin needs channel execution coordinates
- **THEN** it MUST use the Core-provided `ChannelScope` shape instead of defining an equivalent plugin-local target type

#### Scenario: Scope does not equal persistent identity
- **WHEN** two shared scopes differ only by `selfId`
- **THEN** both scopes MUST retain their real `selfId` for Bot routing
- **AND** Core's Channel Key protocol MUST map them to the same persistent Channel identity

## REMOVED Requirements

### Requirement: Channel Scope ID Generation

**Reason**: The `ch_v1_<16-char-hash>` contract conflicts with the new tagged direct/shared Channel Key and its 26-character Base32 encoding.

**Migration**: Consumers MUST use `YesImBotService.channelKey`. Core does not read or map legacy `ChannelScopeId` values.

### Requirement: Channel Scope Metadata Records

**Reason**: The new channel storage protocol owns authoritative `channel.json` Manifests and the derived global Catalog.

**Migration**: Consumers MUST use `YesImBotService.listChannels` and storage resolution. Legacy metadata records remain unread.

### Requirement: Channel Scoped Path Construction

**Reason**: Sharing only a scope ID still lets modules choose inconsistent roots and layouts.

**Migration**: Consumers MUST register a storage namespace and call `YesImBotService.ensureStorage` instead of appending a Key to a plugin-owned root.
