# agent-plugin-system Specification

## Purpose

Define the plugin shell, typed extension surfaces, event channel behavior, hook composition, and error policy for the experimental `@yesimbot/agent-runtime` package.
## Requirements
### Requirement: Stable Plugin Shell

The runtime MUST expose plugins through a stable `AgentPlugin` shell with optional lifecycle methods, optional stable tool declarations, and optional top-level hook methods.

#### Scenario: Plugin declares only hooks it needs

- **WHEN** a plugin only needs to transform messages
- **THEN** it MUST be able to provide only `transformMessages` without implementing unrelated lifecycle methods

#### Scenario: Hook map evolution

- **WHEN** a future hook is added
- **THEN** existing plugins that do not use that hook MUST remain source-compatible

#### Scenario: Static tool declaration

- **WHEN** a plugin provides stable tools through `AgentPlugin.tools`
- **THEN** the plugin MUST NOT need to implement `extendTools`
- **AND** the runtime MUST accept either a stable `AgentToolSet` value or a function resolved during plugin initialization

### Requirement: Typed Declaration Merging

The runtime MUST provide declaration merging surfaces for custom messages, entries, state, and named event channels.
Custom message declarations MUST extend `AgentCustomMessages`; custom entry declarations MUST extend `AgentCustomEntries`; custom channel event declarations MUST extend `AgentCustomChannelEvents`.

#### Scenario: Plugin custom event typing

- **WHEN** a plugin declares a custom event channel type
- **THEN** it MUST declare the channel on `AgentCustomChannelEvents`
- **AND** subscribers to that channel MUST receive the declared event type through `AgentCustomChannelEvent`

#### Scenario: Plugin custom state typing

- **WHEN** a plugin declares optional custom state fields
- **THEN** `agent.state.get()` MUST expose those fields through TypeScript types

#### Scenario: Plugin custom message typing

- **WHEN** a plugin declares a custom message type
- **THEN** it MUST declare the complete message type on `AgentCustomMessages`
- **AND** the declared message MUST be available through `AgentCustomMessage`
- **AND** the declared message MUST be compatible with the public `AgentMessage` union without requiring runtime `meta`

#### Scenario: Custom message constructor typing

- **WHEN** a plugin declares a `role: "custom"` message on `AgentCustomMessages`
- **THEN** `createCustomMessage` MUST infer that message type from the custom message `type`
- **AND** `createCustomMessage` MUST constrain the provided data to the declared custom message data type
- **AND** `createCustomMessage` MUST reject registered messages whose role is not `custom`

#### Scenario: Plugin custom entry typing

- **WHEN** a plugin declares a custom entry type
- **THEN** it MUST declare the entry data on `AgentCustomEntries`
- **AND** the declared entry data MUST be available through `AgentCustomEntryData`
- **AND** the declared entry MUST be preserved by the storage contract without requiring runtime core to understand its semantics

### Requirement: Channel For Observable Events

The runtime MUST provide a named, typed channel API for observable events and plugin-to-plugin communication.

#### Scenario: Core internal event subscription

- **WHEN** a caller subscribes to the `internal` channel
- **THEN** it MUST receive `AgentInternalEvent` values for core runtime lifecycle, turn, message, tool, and plugin diagnostic events emitted by the runtime

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

- **WHEN** a `transformMessages` hook runs for a turn
- **THEN** its context MUST expose historical transformation inputs, typed state, typed channel, and the relevant `turnId` without exposing arbitrary `send`, `append`, or `setTools` methods

#### Scenario: Append hook context storage access

- **WHEN** an append-related hook needs to inspect or add persisted entries
- **THEN** the runtime MAY expose storage capabilities in that hook context while keeping storage absent from hooks that do not need it

#### Scenario: Hook reentrancy boundary

- **WHEN** a plugin hook receives context
- **THEN** the context MUST NOT allow bypassing runtime lifecycle controls by directly starting turns or mutating base tool configuration

#### Scenario: Tool execution context

- **WHEN** a tool is executed during a turn
- **THEN** the runtime MUST inject execution context containing runtime id, channel, state, storage, `turnId`, cancellation signal, and `toolCallId`
- **AND** plugins MUST NOT need to recreate stable tool definitions only to access per-turn execution context

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

#### Scenario: Agent tools carry names

- **WHEN** base tools or plugin-provided tools are configured
- **THEN** each `AgentTool` MUST carry its own `name`
- **AND** the runtime MUST convert the named list to an ai-sdk `ToolSet` only after stable plugin tools and optional dynamic tool extensions have been resolved

#### Scenario: Stable plugin tools resolve once

- **WHEN** the runtime initializes plugins
- **THEN** it MUST resolve `AgentPlugin.tools` once in deterministic plugin order
- **AND** the resulting stable tool registry MUST be reused for later turns until the runtime stops or is recreated

#### Scenario: Dynamic tool extension is opt-in

- **WHEN** no active plugin implements `extendTools`
- **THEN** each turn MUST use the base tools plus stable plugin tool registry without running a dynamic tool hook pipeline

#### Scenario: Dynamic tool extension receives stable snapshot

- **WHEN** one or more active plugins implement `extendTools`
- **THEN** the runtime MUST provide a per-turn copy of base tools plus stable plugin tools as the hook input
- **AND** `extendTools` hooks MUST run after stable tools are collected
- **AND** `extendTools` MAY add, remove, or replace the final visible tool list for that turn

#### Scenario: Tool name conflict

- **WHEN** multiple tools use the same name after plugin extension
- **THEN** the runtime MUST fail the turn with a tool conflict instead of silently overwriting a tool

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

### Requirement: Failed Tool Result Hook Observability

The runtime MUST expose failed tool executions to `afterToolCall` hooks with an error result context before the tool failure is reported back through model tool execution.

#### Scenario: Failed tool reaches after hook

- **WHEN** a tool `execute` function throws during a turn
- **THEN** the runtime MUST call active `afterToolCall` hooks with the same tool call id, tool name, and final arguments
- **AND** the result context MUST set `isError` to `true`
- **AND** the result context MUST include a diagnostic-like error result

#### Scenario: Failed tool after hook remains fail-open

- **WHEN** an `afterToolCall` hook throws while observing a failed tool call
- **THEN** the runtime MUST emit a plugin error diagnostic and continue reporting the original tool failure according to the existing tool execution behavior

#### Scenario: Failed tool result replacement does not mask execution failure

- **WHEN** an `afterToolCall` hook returns a patched result while observing a failed tool call
- **THEN** the runtime MUST NOT treat the original tool execution as successful solely because a hook returned a patched result

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

- **WHEN** a transform, prompt extension, structured prompt append, tool extension, `toModelMessages`, `afterToolCall`, `onAppend`, or `onTurnFinish` hook throws
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

### Requirement: Structured System Prompt Append Hook

The runtime MUST expose an append-only structured system prompt hook for
plugins that need to add system instructions without rewriting the complete
system prompt string.

#### Scenario: Plugin appends string system block
- **WHEN** an active plugin returns a string from the structured system prompt append hook
- **THEN** the runtime MUST append that value as an additional AI SDK system message block

#### Scenario: Plugin appends system model message
- **WHEN** an active plugin returns a `SystemModelMessage` from the structured system prompt append hook
- **THEN** the runtime MUST preserve its `content` and `providerOptions` in the AI SDK system input

#### Scenario: Plugin appends multiple system blocks
- **WHEN** an active plugin returns an array of strings or `SystemModelMessage` values from the structured system prompt append hook
- **THEN** the runtime MUST append each returned block in array order

#### Scenario: Undefined structured append
- **WHEN** the structured system prompt append hook returns `undefined`
- **THEN** the runtime MUST leave the accumulated system prompt input unchanged

#### Scenario: Append-only semantics
- **WHEN** a plugin uses the structured system prompt append hook
- **THEN** the hook MUST NOT receive an API for deleting, replacing, or reordering earlier system prompt blocks

### Requirement: System Prompt Hook Ordering

The runtime MUST compose legacy and structured system prompt hooks in a
deterministic order.

#### Scenario: Legacy hook runs before structured append hook
- **WHEN** the runtime prepares system prompt input for a model call
- **THEN** it MUST run existing `extendSystemPrompt` hooks before structured system prompt append hooks

#### Scenario: Structured append follows plugin order
- **WHEN** multiple active plugins implement the structured system prompt append hook
- **THEN** the runtime MUST evaluate those hooks in deterministic plugin order after plugin `enforce` ordering has been applied

#### Scenario: Legacy-only compatibility
- **WHEN** no active plugin appends structured system prompt blocks
- **THEN** the runtime MUST preserve the legacy final string system prompt shape
