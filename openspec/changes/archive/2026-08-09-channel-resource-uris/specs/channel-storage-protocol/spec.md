# channel-storage-protocol Specification

## MODIFIED Requirements

### Requirement: Scoped Asset Service
The public facade MUST expose `AssetService.createStore(scope)`. A Store MUST be scoped by the persistent ChannelScope tuple, expose `put`, `get`, and `clear`, and keep its concrete implementation private. `put()` MUST atomically deduplicate bytes under the first 32 lowercase hexadecimal characters of their SHA-256 digest and return that complete canonical ID. Presentation elements and URI strings MUST be constructed by the caller rather than by AssetStore.

#### Scenario: Store persists bytes
- **WHEN** a Store receives bytes through `put()`
- **THEN** it MUST atomically deduplicate them under the first 32 lowercase hexadecimal characters of their SHA-256 digest
- **AND** it MUST return that complete canonical ID

#### Scenario: Store resolves an asset reference
- **WHEN** `get()` receives a 7-32 character lowercase hexadecimal ID or prefix
- **THEN** an exact ID or unique prefix MUST return the scoped bytes
- **AND** an absent or ambiguous prefix MUST reject

#### Scenario: Asset reset
- **WHEN** a scoped Store is cleared
- **THEN** only that channel's assets are removed
- **AND** old `asset_` references are not read or migrated


## ADDED Requirements

### Requirement: Channel tool artifact storage
Core MUST expose a current-channel artifact writer through `ChannelPluginContext.artifacts.forTool(toolName)`. Its `put(bytes, { mediaType, filename })` MUST generate a canonical lowercase UUID v7 without a third-party dependency, atomically persist an immutable artifact under `artifacts/<tool-name>/<uuid-v7>/data` and `metadata.json`, and return `artifact://<tool-name>/<uuid-v7>`. `metadata.json` MUST contain only a safe basename filename, media-type hint, and byte length. Core reset MUST remove that channel's `artifacts/` directory with its sessions and assets.

#### Scenario: A tool persists a media artifact
- **WHEN** a channel plugin writes image bytes through its `forTool("mcp_screenshot")` writer
- **THEN** Core MUST return an `artifact://mcp_screenshot/<uuid-v7>` URI only after atomically publishing both data and metadata

#### Scenario: Reset clears tool artifacts
- **WHEN** Core resets a channel
- **THEN** it MUST remove that channel's `artifacts/` directory
- **AND** it MUST preserve that channel's `workspace/` directory