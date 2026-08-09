# channel-storage-protocol Specification

## Requirements

### Requirement: Channel and Conversation Ownership
Core MUST converge persistent channel state under one `Channel` owner containing an immutable `ChannelScope`, a readable root, stable `ChannelResources`, and one `Conversation`. `Channels` MUST own one startup Manifest scan and MUST share concurrent first resolution and in-flight Channel creation.

#### Scenario: Shared scope resolves persistently
- **WHEN** Core resolves a shared scope
- **THEN** its persistent identity MUST be `[platform, channelId]`
- **AND** a different current Bot selfId MUST resolve the same Channel

#### Scenario: Direct scope resolves persistently
- **WHEN** Core resolves a direct scope
- **THEN** its persistent identity MUST be `[platform, selfId, channelId]`
- **AND** a direct scope without selfId MUST be rejected

### Requirement: Versionless Channel Manifest
Core MUST create `channel.json` atomically before returning a channel root. A shared Manifest contains `platform`, `channelId`, and `createdAt`; a direct Manifest additionally contains `selfId`. Malformed, mismatched, legacy, escaping, and symlinked entries MUST be ignored or rejected without overwrite.

#### Scenario: Shared channel root is created
- **WHEN** `resource.get(scope)` is first called for a shared scope
- **THEN** the returned ChannelResources MUST belong to a root whose Manifest omits the current Bot selfId

### Requirement: Resources Facade and Stable Owner
The public facade MUST expose `resource.get(scope)` and `resource.use(reader)`. `resource.get(scope)` MUST return the Channel's stable ChannelResources owner rather than a temporary Store. ChannelResources MUST expose its path and keep Asset and Artifact semantics separate. ResourceReader MUST use `init(resources, uri, options)`.

#### Scenario: Repeated resource lookup
- **WHEN** a plugin requests resources for the same scope more than once
- **THEN** Core MUST return the same ChannelResources owner

### Requirement: Scoped Asset Storage
ChannelResources MUST provide a scoped AssetStore with SHA-256-truncated 32-character lowercase hexadecimal IDs, exact or unique 7-32 character lowercase hexadecimal prefix lookup, atomic deduplication, and scoped clear behavior. The concrete store implementation MUST remain private. Presentation elements and URI strings MUST be constructed by the caller rather than by AssetStore. Invalid, absent, or ambiguous references MUST reject. Old asset references MUST NOT be read or migrated.

#### Scenario: Store persists bytes
- **WHEN** a ChannelResources asset store receives bytes through `put()`
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
### Requirement: Scoped Artifact Storage
ChannelResources MUST provide Artifact storage separately from Asset storage. Artifact IDs, URI scheme, metadata, safe reads, and clear behavior MUST remain distinct from image assets; an artifact operation MUST NOT resolve or clear channel assets.

### Requirement: Channel tool artifact storage
Core MUST expose the current channel's `ChannelResources.artifacts.forTool(toolName)` writer to channel plugins. Its `put(bytes, { mediaType, filename })` MUST generate a canonical lowercase UUID v7 without a third-party dependency, atomically persist an immutable artifact under `artifacts/<tool-name>/<uuid-v7>/data` and `metadata.json`, and return `artifact://<tool-name>/<uuid-v7>`. `metadata.json` MUST contain only a safe basename filename, media-type hint, and byte length. Core reset MUST remove that channel's `artifacts/` directory with its sessions and assets.

#### Scenario: A tool persists a media artifact
- **WHEN** a channel plugin writes image bytes through its `forTool("mcp_screenshot")` writer
- **THEN** Core MUST return an `artifact://mcp_screenshot/<uuid-v7>` URI only after atomically publishing both data and metadata

#### Scenario: Reset clears tool artifacts
- **WHEN** Core resets a channel
- **THEN** it MUST remove that channel's `artifacts/` directory
- **AND** it MUST preserve that channel's `workspace/` directory
### Requirement: Reset Preserves Plugin Data
The private reset path MUST stop and remove the cached runtime, clear only Core-owned conversation history, assets, and artifacts, and preserve `channel.json`, workspace, and every other plugin-created child. Reset MUST NOT require shared assignee admission.
### Requirement: No Legacy Storage Reads
Core MUST NOT read or migrate old directory layouts, old Manifests, old JSONL formats, or global channel registry files. Current readable channel roots and their authoritative Manifests are the only persistent channel format.
