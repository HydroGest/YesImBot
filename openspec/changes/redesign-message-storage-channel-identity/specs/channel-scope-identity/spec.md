## ADDED Requirements

### Requirement: Stable Logical Channel Identity
Core MUST expose `channelIdentity(scope)` as the stable lowercase 26-character logical identifier from the versioned canonical tuple, SHA-256 truncation, and Base32 encoding.

#### Scenario: Shared and direct scopes are identified
- **WHEN** Core identifies shared scopes that differ only by `selfId` or direct scopes that differ by `selfId`
- **THEN** shared scopes MUST share an identity and direct scopes MUST have distinct identities

### Requirement: No Channel Key Alias
Core and plugins MUST use `channelIdentity` for logical identity and MUST NOT expose or call a `channelKey` alias.

#### Scenario: Plugin requests an identity
- **WHEN** a plugin needs a stable channel identifier
- **THEN** it MUST use the Core `channelIdentity` API without assuming a filesystem path
