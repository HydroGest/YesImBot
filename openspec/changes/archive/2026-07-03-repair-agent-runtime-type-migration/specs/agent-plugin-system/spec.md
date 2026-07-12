## MODIFIED Requirements

### Requirement: Typed Declaration Merging
The runtime MUST provide declaration merging surfaces for custom messages, entries, state, and named event channels.

#### Scenario: Plugin custom event typing
- **WHEN** a plugin declares a custom event channel type
- **THEN** subscribers to that channel MUST receive the declared event type

#### Scenario: Plugin custom state typing
- **WHEN** a plugin declares optional custom state fields
- **THEN** `agent.state.get()` MUST expose those fields through TypeScript types

#### Scenario: Plugin custom message typing
- **WHEN** a plugin declares a custom message type
- **THEN** the declared message MUST be compatible with the public `AgentMessage` union without requiring runtime `meta`

#### Scenario: Plugin custom entry typing
- **WHEN** a plugin declares a custom entry type
- **THEN** the declared entry MUST be preserved by the storage contract without requiring runtime core to understand its semantics

### Requirement: Channel For Observable Events
The runtime MUST provide a named, typed channel API for observable events and plugin-to-plugin communication.

#### Scenario: Core internal event subscription
- **WHEN** a caller subscribes to the `internal` channel
- **THEN** it MUST receive core runtime lifecycle, turn, message, tool, and plugin diagnostic events emitted by the runtime

#### Scenario: Stream event subscription
- **WHEN** a caller subscribes to the `stream` channel
- **THEN** it MUST receive stream events emitted by the runtime for model streaming behavior

#### Scenario: Turn event turnId
- **WHEN** the runtime emits a turn-related internal event
- **THEN** the event MUST carry the relevant `turnId`

#### Scenario: Non-turn event without turnId
- **WHEN** the runtime emits a non-turn internal event such as `agent.init`, `agent.stop`, or `plugin.disabled`
- **THEN** the event MUST NOT require a `turnId`

#### Scenario: Custom channel emission
- **WHEN** a plugin emits a custom channel event
- **THEN** listeners for that channel MUST receive the event without requiring a hook registration API

### Requirement: Core Event Taxonomy
The runtime MUST define a small stable core event taxonomy under `agent.*`, `turn.*`, `message.*`, `tool.*`, and `plugin.*` event `type` values on the `internal` channel.

#### Scenario: Turn event emission
- **WHEN** a turn is queued, started, produces a step, emits a delta, completes, fails, or aborts
- **THEN** the runtime MUST emit a typed `turn.*` event with the relevant `turnId`

#### Scenario: Message appended event emission
- **WHEN** the runtime appends a message as part of a turn
- **THEN** it MUST emit a `message.appended` internal event with the relevant `turnId`

#### Scenario: Observation append event emission
- **WHEN** the runtime appends a message outside a turn
- **THEN** it MUST emit a `message.appended` internal event without requiring `turnId`

#### Scenario: Tool event emission
- **WHEN** a tool starts, completes, fails, or is blocked
- **THEN** the runtime MUST emit a typed `tool.*` event with the relevant `turnId` and tool name

#### Scenario: Plugin diagnostic event
- **WHEN** a plugin hook fails open or an optional plugin is disabled
- **THEN** the runtime MUST emit a typed `plugin.*` diagnostic event on the `internal` channel

#### Scenario: Event payload boundaries
- **WHEN** the runtime emits a core internal event
- **THEN** the event MUST contain stable fields such as type and relevant small diagnostic details
- **AND** it MUST NOT require large model or tool payloads to be embedded

### Requirement: Narrow Hook Context
The runtime MUST provide hook-specific context objects that expose only stable capabilities needed by that hook and MUST NOT pass the full mutable `Agent` object to every hook.

#### Scenario: Transform hook context
- **WHEN** a `transformMessages` hook runs for a turn
- **THEN** its context MUST expose historical transformation inputs, typed state, typed channel, and the relevant `turnId` without exposing arbitrary `send`, `append`, or `setTools` methods

#### Scenario: Append hook context storage access
- **WHEN** an append-related hook needs to inspect or add persisted entries
- **THEN** the runtime MAY expose storage capabilities in that hook context while keeping storage absent from hooks that do not need it

#### Scenario: Hook reentrancy boundary
- **WHEN** a plugin hook receives context
- **THEN** the context MUST NOT allow bypassing runtime lifecycle controls by directly starting turns or mutating base tool configuration
