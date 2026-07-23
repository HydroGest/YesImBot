# channel-scope-identity Specification

## Purpose

Define the shared channel execution scope and the canonical direct/shared identity boundary used by Core and optional plugins.

## Requirements

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

### Requirement: No Legacy Identity Compatibility

The channel scope identity capability MUST NOT preserve legacy channel target names, legacy path formats, legacy workspace IDs, or legacy MemOS channel hashes.

#### Scenario: Old data exists
- **WHEN** old experimental session files, workspace directories, or MemOS identities exist
- **THEN** the new channel scope identity APIs MUST NOT be required to read, migrate, alias, or preserve them
