## MODIFIED Requirements

### Requirement: Group-Chat-Friendly Memory Identity

The MemOS client plugin MUST derive stable short MemOS identities that match yesimbot's group-chat use case while avoiding raw platform id exposure by default.

#### Scenario: Group channels use channel-scoped memory
- **WHEN** the current channel type is `group`
- **THEN** the plugin MUST derive MemOS `user_id` from the core-provided `ChannelScopeId`
- **AND** the resulting id MUST use the `yb_ch_` prefix
- **AND** the id MUST be short enough for MemOS Cloud user id limits

#### Scenario: Private channels use author-scoped memory
- **WHEN** the current channel type is `private`
- **THEN** the plugin MUST derive MemOS `user_id` from platform and current author id
- **AND** the resulting id MUST use the `yb_u_` prefix
- **AND** the id MUST be short enough for MemOS Cloud user id limits

#### Scenario: Channel metadata uses shared channel scope id
- **WHEN** the plugin sends MemOS `info` metadata for a channel
- **THEN** the channel hash metadata MUST use the core-provided `ChannelScopeId` or a core-provided channel scope hash derived from the same canonical input
- **AND** it MUST NOT be derived by plugin-local raw string concatenation

#### Scenario: Identity uses stable hash versioning
- **WHEN** the plugin derives MemOS channel-scoped identity
- **THEN** it MUST rely on the versioned `ChannelScopeId`
- **AND** it MUST use stable cryptographic hash representations rather than random ids

#### Scenario: Raw identity metadata is omitted by default
- **WHEN** the plugin sends MemOS `info` metadata
- **THEN** it MUST use hashed or canonical scope-id source metadata by default
- **AND** it MUST NOT send raw platform author, channel, self, or message ids unless explicitly configured
