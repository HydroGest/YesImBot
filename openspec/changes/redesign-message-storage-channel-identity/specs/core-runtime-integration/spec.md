## ADDED Requirements

### Requirement: Identity-Keyed Input Runtime
RuntimeManager and ChannelRuntime MUST use `channelIdentity` for runtime ownership and MUST route `MessageRecord | EventRecord` through one channel FIFO.

#### Scenario: Input is committed
- **WHEN** a current input reaches a ChannelRuntime
- **THEN** it MUST create the corresponding input, append it, emit `yesimbot/event`, decide Will, and preserve one stream consumer

### Requirement: Current JSONL Layout
ChannelRuntime MUST obtain `sessions/messages.jsonl`, assets, and namespaces through Manifest-backed storage and MUST not derive paths from the logical identity.

#### Scenario: Runtime restarts
- **WHEN** Core recreates a runtime for a current readable channel directory
- **THEN** it MUST read only current-format JSONL from that directory
