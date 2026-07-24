## MODIFIED Requirements

### Requirement: Historical Message Transformation

`transformMessages` MUST remain implemented for source compatibility and its public declaration MUST be marked deprecated. It MUST continue to operate on historical messages only and MUST NOT receive current turn live messages. Core and new plugins MUST NOT use it. Agents that use this compatibility hook are outside the cache-stable historical projection contract until a later compaction design defines an explicit reset protocol.

#### Scenario: Current trigger message survives compatibility transformation
- **WHEN** a deprecated transform hook changes historical messages
- **THEN** the current turn submitted message MUST still append after transformation before model conversion

#### Scenario: New plugin needs historical compaction
- **WHEN** a new plugin needs to prune, summarize, reorder, or reinterpret history
- **THEN** it MUST NOT use `transformMessages`
- **AND** the compaction capability MUST define an explicit cache-lifecycle reset before implementation

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
