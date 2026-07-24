## ADDED Requirements

### Requirement: Immutable Runtime Media Snapshot
RuntimeManager MUST snapshot the resolved image-input capability and configured model-call media policy when creating a ChannelRuntime. ChannelRuntime MUST reuse that snapshot for its lifetime, and a changed capability or policy MUST activate only through Runtime replacement or explicit non-destructive reload.

#### Scenario: Existing runtime handles another model call
- **WHEN** model metadata or multimedia configuration changes after ChannelRuntime initialization
- **THEN** the active runtime MUST retain its existing media capability and policy snapshot

#### Scenario: Runtime is reloaded
- **WHEN** a trusted caller reloads the channel after a media policy change
- **THEN** the replacement runtime MUST use the latest resolved capability and policy without clearing history or assets

## MODIFIED Requirements

### Requirement: Default Will Routing Configuration
Core Will configuration MUST select `routing` or `willingness`, defaulting to `routing`. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`; its defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Willingness configuration MUST use static values snapshotted by the ChannelRuntime. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no engine or routing override is configured
- **THEN** the routing Will MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

#### Scenario: Willingness engine is selected
- **WHEN** configuration explicitly selects `willingness`
- **THEN** RuntimeManager MUST construct the temporary static willingness engine for future ChannelRuntimes

### Requirement: Model Resolution Boundary
Core MUST resolve the configured chat model through `ctx["yesimbot.model"]`, pass only the resolved `LanguageModel` to agent-runtime, and derive the model entry's resolved image-input capability for the owning ChannelRuntime's immutable media snapshot.

#### Scenario: Channel runtime creation
- **WHEN** core creates a channel runtime
- **THEN** it MUST resolve `config.chatModel` through the model service
- **AND** it MUST pass the resolved `LanguageModel` to `createAgent`
- **AND** it MUST pass only the derived image-input capability and media policy to Core projection ownership

#### Scenario: Model configuration changes
- **WHEN** model configuration or provider registration changes after a channel runtime has been created
- **THEN** core MUST NOT hot-swap the model or media capability for that runtime
