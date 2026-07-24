## ADDED Requirements

### Requirement: Append-Only Model Request Prefix

Within one Agent cache lifecycle, the runtime MUST preserve the model-visible projection and order of every previously sent persisted message and MUST append new current messages, assistant responses, tool calls, and tool results after that prefix.

#### Scenario: Later turn prepares a model request
- **WHEN** an earlier turn's messages remain in storage and no cache-lifecycle input changed
- **THEN** the later request MUST retain the earlier model request as an equivalent prefix
- **AND** it MUST append later persisted messages in storage order

#### Scenario: Tool loop prepares another model step
- **WHEN** a step persists assistant tool calls and matching tool results
- **THEN** the next step MUST append those messages after the prior step's request
- **AND** it MUST NOT regenerate or reorder the earlier model-visible prefix

### Requirement: Immutable Agent Model And Base Tools

The public `Agent` interface MUST NOT expose `setModel()` or `setTools()`. The runtime MUST receive its model and base tools through `createAgent()` configuration and MUST keep them fixed until the Agent stops.

#### Scenario: Caller inspects the Agent interface
- **WHEN** TypeScript code uses the public `Agent` type
- **THEN** `setModel` and `setTools` MUST NOT be available

#### Scenario: Runtime needs another model or tool registry
- **WHEN** a caller needs to change the configured model or base tools
- **THEN** it MUST create a replacement Agent or ChannelRuntime
- **AND** it MUST NOT mutate the active Agent cache lifecycle

## MODIFIED Requirements

### Requirement: Runtime Resource Separation

The runtime MUST treat `LanguageModel`, provider identity, and stable system input as runtime resources rather than persisted message state. `AgentConfig.systemPrompt` MUST accept `SystemPromptAppend` or a resolver `(runtime: AgentPluginRuntime) => Awaitable<SystemPromptAppend | void>`. Agent initialization MUST resolve that input once and reuse it for every model request in the same cache lifecycle.

#### Scenario: Agent initializes stable system input
- **WHEN** the runtime initializes an Agent
- **THEN** it MUST invoke a configured system prompt resolver at most once
- **AND** it MUST resolve stable plugin prompt contributions during the same initialization
- **AND** it MUST retain the resulting segment order and content until the Agent stops

#### Scenario: Base system input fails before plugin startup
- **WHEN** the configured system prompt resolver throws during Agent initialization
- **THEN** the runtime MUST fail initialization before invoking any plugin `init` hook

#### Scenario: Model or provider replacement is required
- **WHEN** a caller needs a different model or provider for an initialized Agent
- **THEN** the caller MUST create a replacement Agent or ChannelRuntime cache lifecycle
- **AND** the runtime MUST NOT mutate the active lifecycle's model resource in place

#### Scenario: Structured system prompt model input
- **WHEN** the frozen system input contains structured `SystemModelMessage` values
- **THEN** the runtime MUST pass them through AI SDK's `system` option
- **AND** it MUST preserve their content, order, and `providerOptions`
- **AND** it MUST NOT inject them into the model `messages` array

#### Scenario: Legacy string prompt compatibility
- **WHEN** the frozen system input contains only one legacy string prompt and no structured blocks
- **THEN** the runtime MAY continue passing that prompt as a string to AI SDK
- **AND** it MUST NOT resolve or rewrite the string again for each model call

#### Scenario: Structured prompt without base string
- **WHEN** no base string is configured and stable plugins append structured system blocks
- **THEN** the runtime MUST still pass those blocks through AI SDK's `system` option

### Requirement: Base Tool Support

The runtime MUST support base tools and stable plugin-provided tools, MUST resolve the complete stable registry during Agent initialization, and MUST reuse it in deterministic order for later turns. The deprecated `extendTools` compatibility hook MUST also resolve at most once during initialization.

#### Scenario: Stable tool order
- **WHEN** the runtime initializes tools
- **THEN** it MUST start with base tools configured on the Agent
- **AND** it MUST append stable plugin tools in deterministic plugin order

#### Scenario: Stable plugin tool reuse
- **WHEN** a plugin declares tools through `AgentPlugin.tools`
- **THEN** the runtime MUST resolve that declaration once during plugin initialization
- **AND** it MUST reuse the same tool definitions for every turn in the Agent cache lifecycle

#### Scenario: Deprecated tool extension remains source-compatible
- **WHEN** existing source code provides `extendTools`
- **THEN** the runtime package MUST retain the hook during this change
- **AND** its public declaration MUST identify the hook as deprecated
- **AND** Core and new plugins MUST use `AgentPlugin.tools` instead

#### Scenario: Deprecated tool extension initializes
- **WHEN** an Agent initializes with an `extendTools` compatibility hook
- **THEN** the hook MUST receive a copy of the stable base and plugin tool registry
- **AND** the runtime MUST freeze its returned tools for the Agent lifecycle
- **AND** it MUST NOT invoke the hook again for a later model call

#### Scenario: Tool name conflict
- **WHEN** a plugin-provided tool has the same name as a base tool or another plugin tool
- **THEN** the runtime MUST fail tool-registry preparation unless an explicit override mechanism is specified

#### Scenario: Tool execution gets turn context
- **WHEN** the model calls a tool
- **THEN** the runtime MUST pass the current `turnId`, cancellation signal, `toolCallId`, runtime id, channel, state, and storage through the tool execution context
