## ADDED Requirements

### Requirement: Stable Plugin Shell
The runtime MUST expose plugins through a stable `AgentPlugin` shell with optional lifecycle methods and a `hooks?: Partial<AgentPluginHooks>` map.

#### Scenario: Plugin declares only hooks it needs
- **WHEN** a plugin only needs to transform messages
- **THEN** it MUST be able to provide only `hooks.transformMessages` without implementing unrelated lifecycle methods

#### Scenario: Hook map evolution
- **WHEN** a future hook is added
- **THEN** existing plugins that do not use that hook MUST remain source-compatible

### Requirement: Typed Declaration Merging
The runtime MUST provide declaration merging surfaces for custom messages, entries, state, events, and plugin hooks.

#### Scenario: Plugin custom event typing
- **WHEN** a plugin declares a custom event channel type
- **THEN** subscribers to that channel MUST receive the declared event type

#### Scenario: Plugin custom state typing
- **WHEN** a plugin declares optional custom state fields
- **THEN** `agent.state.get()` MUST expose those fields through TypeScript types

### Requirement: Channel For Observable Events
The runtime MUST provide a typed channel API for observable events and plugin-to-plugin communication.

#### Scenario: Core agent event subscription
- **WHEN** a caller subscribes to the runtime channel
- **THEN** it MUST receive turn lifecycle and stream events tagged with `turnId`

#### Scenario: Custom channel emission
- **WHEN** a plugin emits a custom channel event
- **THEN** listeners for that channel MUST receive the event without requiring a hook registration API

### Requirement: Core Event Taxonomy
The runtime MUST define a small stable core event taxonomy under `agent.*`, `turn.*`, `message.*`, `tool.*`, and `plugin.*`.

#### Scenario: Turn event emission
- **WHEN** a turn is queued, started, produces a step, emits a delta, completes, fails, or aborts
- **THEN** the runtime MUST emit a typed `turn.*` event with the relevant `turnId`

#### Scenario: Tool event emission
- **WHEN** a tool starts, completes, fails, or is blocked
- **THEN** the runtime MUST emit a typed `tool.*` event with the relevant `turnId` and tool name

#### Scenario: Plugin diagnostic event
- **WHEN** a plugin hook fails open or an optional plugin is disabled
- **THEN** the runtime MUST emit a typed `plugin.*` diagnostic event

#### Scenario: Event payload boundaries
- **WHEN** the runtime emits a core event
- **THEN** the event MUST contain stable metadata such as id, timestamp, event name, optional turn id, optional plugin name, and cause, and MUST NOT require large model or tool payloads to be embedded

### Requirement: Hooks For Runtime Behavior
The runtime MUST use hooks, not channels, for ordered behavior that changes runtime execution.

#### Scenario: Message transform hook
- **WHEN** plugins transform historical messages
- **THEN** the runtime MUST run `transformMessages` hooks in deterministic plugin order and use the transformed result

#### Scenario: Custom message conversion hook
- **WHEN** the runtime converts a custom message for model input
- **THEN** it MUST use `toModelMessages` hooks rather than channel listeners

### Requirement: Narrow Hook Context
The runtime MUST provide hook-specific context objects that expose only stable capabilities needed by that hook and MUST NOT pass the full mutable `Agent` object to every hook.

#### Scenario: Transform hook context
- **WHEN** a `transformMessages` hook runs
- **THEN** its context MUST expose historical transformation inputs, typed state, typed channel, diagnostics, and relevant turn metadata without exposing arbitrary `send`, `append`, or `setTools` methods

#### Scenario: Append hook context storage access
- **WHEN** an append-related hook needs to inspect or add persisted entries
- **THEN** the runtime MAY expose storage capabilities in that hook context while keeping storage absent from hooks that do not need it

#### Scenario: Hook reentrancy boundary
- **WHEN** a plugin hook receives context
- **THEN** the context MUST NOT allow bypassing runtime lifecycle controls by directly starting turns or mutating base tool configuration

### Requirement: Historical Message Transformation
`transformMessages` hooks MUST operate on historical messages only and MUST NOT receive current turn live messages.

#### Scenario: Current trigger message survives context pruning
- **WHEN** a transform hook prunes old historical messages
- **THEN** the current turn submitted message MUST still be appended after transformation before model conversion

### Requirement: Custom Message Conversion
`toModelMessages` hooks MUST convert custom `AgentMessage` values into `ai-sdk` compatible model messages.

#### Scenario: First conversion wins
- **WHEN** multiple plugins can convert the same custom message
- **THEN** the runtime MUST use the first non-empty conversion in deterministic plugin order

#### Scenario: Unconverted custom message
- **WHEN** no plugin converts a custom message
- **THEN** the runtime MUST omit it from model input

### Requirement: Tool Hook Composition
The runtime MUST define deterministic composition rules for tool hooks.

#### Scenario: Before tool block
- **WHEN** a `beforeToolCall` hook returns a block decision
- **THEN** the runtime MUST stop evaluating later before hooks for that tool call and MUST NOT execute the tool

#### Scenario: Before tool replace
- **WHEN** a `beforeToolCall` hook replaces tool arguments
- **THEN** the runtime MUST pass the replaced arguments to later before hooks and tool execution

#### Scenario: Before tool allow
- **WHEN** a `beforeToolCall` hook returns allow
- **THEN** the runtime MUST continue evaluating later before hooks

#### Scenario: After tool merge
- **WHEN** `afterToolCall` hooks return partial result overrides
- **THEN** the runtime MUST apply them as a pipeline over the current tool result

### Requirement: Plugin Error Policy
The runtime MUST apply explicit default error policies by hook category.

#### Scenario: Init failure
- **WHEN** a non-optional plugin fails during `init`
- **THEN** agent initialization MUST fail and already initialized plugins MUST be stopped in reverse order

#### Scenario: Optional plugin init failure
- **WHEN** a plugin declared with `optional: true` fails during `init`
- **THEN** the runtime MUST disable that plugin, emit diagnostics, and continue initialization

#### Scenario: Before tool plugin failure
- **WHEN** a `beforeToolCall` hook throws
- **THEN** the runtime MUST block that tool call by default

#### Scenario: Transform plugin failure
- **WHEN** a transform, prompt extension, tool extension, `toModelMessages`, `afterToolCall`, `onAppend`, or `onTurnFinish` hook throws
- **THEN** the runtime MUST emit a plugin error diagnostic and continue with the previous or fallback value

### Requirement: Dogfood Plugin Scope
The plugin system MUST be sufficient to implement compaction as the first validation plugin and audit as a development diagnostic plugin, while HITL remains out of scope for this change.

#### Scenario: Compact plugin extension points
- **WHEN** a compact plugin is implemented
- **THEN** it MUST be able to use custom entries, state, append hooks, `transformMessages`, and `toModelMessages` without runtime-core compact types

#### Scenario: Audit plugin extension points
- **WHEN** an audit plugin is used during development
- **THEN** it MUST be able to subscribe to typed channel events and persist additional diagnostics without changing core event persistence defaults

#### Scenario: HITL omitted
- **WHEN** human approval or intervention is considered
- **THEN** the runtime design MUST treat HITL as out of scope unless a separate future capability is proposed
