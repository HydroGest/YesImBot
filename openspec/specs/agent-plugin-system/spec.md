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

`transformMessages` MUST remain implemented for source compatibility and its public declaration MUST be marked deprecated. It MUST continue to operate on historical messages only and MUST NOT receive current turn live messages. Core and new plugins MUST NOT use it. Agents that use this compatibility hook are outside the cache-stable historical projection contract until a later compaction design defines an explicit reset protocol.

#### Scenario: Current trigger message survives compatibility transformation

- **WHEN** a deprecated transform hook changes historical messages
- **THEN** the current turn submitted message MUST still append after transformation before model conversion

#### Scenario: New plugin needs historical compaction

- **WHEN** a new plugin needs to prune, summarize, reorder, or reinterpret history
- **THEN** it MUST NOT use `transformMessages`
- **AND** the compaction capability MUST define an explicit cache-lifecycle reset before implementation

### Requirement: Custom Message Conversion

`toModelMessages` hooks MUST convert custom `AgentMessage` values into `ai-sdk` compatible model messages.

#### Scenario: First conversion wins

- **WHEN** multiple plugins can convert the same custom message
- **THEN** the runtime MUST use the first non-empty conversion in deterministic plugin order

#### Scenario: Unconverted custom message

- **WHEN** no plugin converts a custom message
- **THEN** the runtime MUST omit it from model input

### Requirement: Tool Hook Composition

The runtime MUST define deterministic composition rules for tool hooks. Stable tools MUST come from base Agent configuration and `AgentPlugin.tools`; the deprecated `extendTools` compatibility hook MUST resolve at most once during initialization and MUST NOT be used by Core or new plugins.

#### Scenario: Agent tools carry names

- **WHEN** base tools or plugin-provided tools are configured
- **THEN** each `AgentTool` MUST carry its own `name`
- **AND** the runtime MUST convert the frozen named list to an AI SDK `ToolSet`

#### Scenario: Stable plugin tools resolve once

- **WHEN** the runtime initializes plugins
- **THEN** it MUST resolve `AgentPlugin.tools` once in deterministic plugin order
- **AND** the resulting stable tool registry MUST be reused for later turns until the runtime stops or is recreated

#### Scenario: Deprecated tool extension

- **WHEN** source code accesses `extendTools`
- **THEN** the hook MUST be marked deprecated
- **AND** documentation MUST direct new plugins to `AgentPlugin.tools`

#### Scenario: Deprecated extension receives stable snapshot

- **WHEN** compatibility code initializes `extendTools`
- **THEN** the runtime MUST provide a copy of the stable base and plugin tool registry
- **AND** it MUST freeze the returned registry for the Agent lifecycle
- **AND** it MUST NOT invoke the hook for later model calls

#### Scenario: Tool name conflict

- **WHEN** multiple tools use the same name after tool collection
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

The runtime MUST expose an append-only structured system prompt hook for stable plugin instructions. It MUST resolve the hook once during plugin initialization and freeze the returned blocks for the Agent cache lifecycle.

#### Scenario: Plugin appends string system block
- **WHEN** an active plugin returns a string from the structured system prompt append hook during initialization
- **THEN** the runtime MUST append that value as an additional AI SDK system message block

#### Scenario: Plugin appends system model message
- **WHEN** an active plugin returns a `SystemModelMessage` during initialization
- **THEN** the runtime MUST preserve its `content` and `providerOptions` in the AI SDK system input

#### Scenario: Plugin appends multiple system blocks
- **WHEN** an active plugin returns an array of strings or `SystemModelMessage` values
- **THEN** the runtime MUST append each returned block in array order

#### Scenario: Undefined structured append
- **WHEN** the structured system prompt append hook returns `undefined`
- **THEN** the runtime MUST leave the accumulated system prompt input unchanged

#### Scenario: Append-only semantics
- **WHEN** a plugin uses the structured system prompt append hook
- **THEN** the hook MUST NOT receive an API for deleting, replacing, or reordering earlier system prompt blocks

#### Scenario: Later turn uses plugin instructions

- **WHEN** a later model call runs in the same Agent cache lifecycle
- **THEN** the runtime MUST reuse the frozen plugin blocks
- **AND** it MUST NOT invoke the append hook again for that model call

#### Scenario: Required plugin stable resource fails

- **WHEN** a required plugin throws while resolving `tools`, `appendSystemPrompt`, or a deprecated initialization hook
- **THEN** Agent initialization MUST fail
- **AND** the host MUST stop already initialized plugins in reverse order

#### Scenario: Optional plugin stable resource fails

- **WHEN** an optional plugin throws while resolving a stable tool or prompt resource
- **THEN** the host MUST disable that entire plugin
- **AND** it MUST retain none of that plugin's tools or prompt blocks
- **AND** it MUST emit a `plugin.disabled` diagnostic

### Requirement: System Prompt Hook Ordering

The runtime MUST compose immutable configured system input and stable structured plugin blocks in deterministic order. The legacy `extendSystemPrompt` hook MUST be deprecated, MUST run at most once during initialization for a legacy single-string base prompt, and MUST NOT receive or rewrite structured Core system input.

#### Scenario: Core Constitution enters system input
- **WHEN** Core initializes an Agent with an immutable constitution
- **THEN** the runtime MUST place that constitution before plugin prompt blocks
- **AND** no plugin hook MUST receive an API that can replace it

#### Scenario: Structured append follows plugin order
- **WHEN** multiple active plugins append structured system blocks during initialization
- **THEN** the runtime MUST evaluate them in deterministic plugin order after plugin `enforce` ordering

#### Scenario: Legacy prompt hook remains available
- **WHEN** existing source code references `extendSystemPrompt`
- **THEN** the runtime package MUST retain the implementation during this change
- **AND** its public declaration MUST identify the hook as deprecated
- **AND** Core and new plugins MUST use structured append instead

#### Scenario: Legacy-only compatibility initializes

- **WHEN** compatibility code configures one legacy string prompt
- **THEN** the runtime MAY pass that string through `extendSystemPrompt` once during initialization
- **AND** it MAY preserve the final legacy string shape
- **AND** it MUST NOT invoke the hook again for a later model call

#### Scenario: Structured Core input bypasses legacy rewrite

- **WHEN** configured system input contains structured blocks
- **THEN** `extendSystemPrompt` MUST NOT receive any of those blocks

### Requirement: Read-Only Model Conversion Boundary
The existing `toModelMessages` hook context MUST expose read-only `history` and `current` AgentMessage arrays for that one `buildModelMessages` call. `history` MUST contain the compatibility-transformed historical array that will be converted, and `current` MUST contain only the untouched batch newly submitted for this model request. The runtime MUST create a fresh context identity for each call and MUST preserve final output order as history followed by current.

#### Scenario: Initial request converts a submitted batch
- **WHEN** `buildModelMessages` converts history and an initial submitted batch
- **THEN** every `toModelMessages` invocation for that call MUST receive the same context object
- **AND** its `current` array MUST contain that submitted batch in order

#### Scenario: Later tool step has no new input
- **WHEN** a later model step rebuilds messages without a newly submitted batch
- **THEN** the conversion context's `current` array MUST be empty
- **AND** earlier inputs MUST appear only in history at their persisted positions

#### Scenario: Joined batch reaches a model step
- **WHEN** newly joined messages are drained before a later model step
- **THEN** the conversion context's `current` array MUST contain only that newly drained batch

#### Scenario: Deprecated historical transform runs
- **WHEN** compatibility `transformMessages` changes historical messages before conversion
- **THEN** the context MUST expose that transformed history
- **AND** it MUST keep current input outside the deprecated transform

### Requirement: No Additional Media Preparation Hook
AgentPlugin MUST NOT add a media-specific or side-effect-only model-message preparation hook. Call-aware custom-message conversion MUST use the existing `toModelMessages` hook and its read-only boundary context, and MUST NOT restore deprecated `transformMessages` as a media pipeline.

#### Scenario: Core selects call-scoped media
- **WHEN** Core needs the complete model-call boundary to allocate image budget
- **THEN** it MUST inspect the read-only `toModelMessages` context
- **AND** it MUST NOT mutate, delete, replace, or reorder source AgentMessages

### Requirement: Core Plugin Factory Host Contract
Core MUST call each AgentPluginFactory as `factory(scope, bot)`, where `scope` is the immutable ChannelScope and `bot` is the current Bot. A factory MAY declare the optional static `requiresMessageId` capability.

#### Scenario: Core initializes channel plugins
- **WHEN** a ChannelRuntime is created
- **THEN** each factory receives its scope and current Bot as separate arguments

### Requirement: Current Bot Platform Operations
Core Agent plugins that perform platform operations MUST use the supplied current Bot and MUST NOT query the Bot registry again.

#### Scenario: Shared channel Bot changes
- **WHEN** Core replaces a shared-channel runtime for a new Bot
- **THEN** plugins initialized for that runtime receive the new Bot
