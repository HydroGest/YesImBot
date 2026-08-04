## MODIFIED Requirements

### Requirement: Scoped Asset Service

The public facade MUST expose `AssetService.createStore(scope)` overloads for ChannelScope and GlobalScope. A ChannelScope Store MUST use the existing channel tuple. A GlobalScope Store MUST use the stable agentId and the GlobalAgent root. Both Store kinds MUST expose `put`, `get`, and `clear`, and their concrete implementations MUST remain private.

#### Scenario: Store persists image bytes

- **WHEN** either scoped Store receives bytes through `put()`
- **THEN** it MUST atomically deduplicate them under the first 32 lowercase hexadecimal characters of their SHA-256 digest
- **AND** return `h("img", { id })` containing that complete ID

#### Scenario: Store resolves an asset reference

- **WHEN** `get()` receives a 7-32 character lowercase hexadecimal ID or prefix
- **THEN** an exact ID or unique prefix MUST return the scoped bytes
- **AND** an absent or ambiguous prefix MUST reject

#### Scenario: Channel asset reset

- **WHEN** a ChannelScope Store is cleared
- **THEN** only that channel's assets MUST be removed
- **AND** old `asset_` references MUST NOT be read or migrated

#### Scenario: GlobalAgent asset reset

- **WHEN** a GlobalScope Store is cleared
- **THEN** only that GlobalAgent's assets MUST be removed
- **AND** assets with the same ID in ChannelScope Stores MUST remain untouched

#### Scenario: GlobalAgent references a channel asset

- **WHEN** a caller asks a GlobalScope Store to resolve an ID that exists only in a ChannelScope Store
- **THEN** the GlobalScope Store MUST reject
- **AND** it MUST NOT search channel roots
