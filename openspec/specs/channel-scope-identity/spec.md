# channel-scope-identity Specification

## Requirements

### Requirement: Channel scope is the public channel context
Core MUST expose `ChannelScope` with required `platform`, `selfId`, `channelId`, and `isDirect` fields. `selfId` identifies the current Bot for both direct and shared scopes.

#### Scenario: A plugin receives a shared scope
- **WHEN** Core creates a plugin for a shared channel
- **THEN** the plugin receives the raw platform, current Bot, channel, and directness fields

### Requirement: Persistent channel coordinates follow tuple semantics
Shared channels MUST use `[platform, channelId]` and direct channels MUST use `[platform, selfId, channelId]` to select persistent state.

#### Scenario: A shared channel changes Bot
- **WHEN** the current Bot changes for the same shared platform and channel
- **THEN** its persistent channel state remains the same

### Requirement: Channel directories are readable and versionless
Channel roots MUST use safe readable `shared-*` or `direct-*` directory names under `channels/`. Raw coordinates that contain delimiters or traversal-looking text MUST not collide or escape the channels root.

#### Scenario: A direct channel has unsafe raw coordinates
- **WHEN** Core creates its channel root
- **THEN** the resulting directory remains below `channels/` and is distinct from differently-valued raw coordinates

### Requirement: No public channel identity exists
Core MUST NOT expose a ChannelKey, channel identity string, opaque channel identifier, or directory helper as a package API.
