# channel-scope-identity Specification

## Purpose

Define direct/shared execution scope and the stable logical identity used by Core and plugins.

## Requirements

### Requirement: Channel Scope Type
Core MUST expose `ChannelScope` with `platform`, `selfId`, `channelId`, and `isDirect` and MUST exclude author, message, guild, assignee, display-name, and plugin-specific fields.

#### Scenario: Scope is created from a Session
- **WHEN** Gateway derives a scope from a valid Session
- **THEN** it MUST preserve real `selfId` and direct/shared classification

### Requirement: Stable Logical Channel Identity
Core MUST expose `channelIdentity(scope)` as the stable lowercase 26-character logical identifier from the versioned canonical tuple, SHA-256 truncation, and Base32 encoding.

#### Scenario: Shared and direct scopes are identified
- **WHEN** shared scopes differ only by `selfId` or direct scopes differ by `selfId`
- **THEN** shared scopes MUST share an identity and direct scopes MUST have distinct identities

### Requirement: No Legacy Identity Compatibility
Core and plugins MUST use `channelIdentity` for logical identity and MUST NOT expose `channelKey`, legacy path formats, aliases, migration, or fallback identity readers.

#### Scenario: Plugin requests an identity
- **WHEN** a plugin needs a stable channel identifier
- **THEN** it MUST use the Core `channelIdentity` API without assuming a filesystem path
