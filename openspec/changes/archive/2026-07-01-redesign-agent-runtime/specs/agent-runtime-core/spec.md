## ADDED Requirements

### Requirement: Message-Centered Runtime Types
The new runtime MUST use `AgentMessage` as the core historical semantic unit and MUST NOT expose `AgentInput` or `AgentOutput` as public core concepts.

#### Scenario: Custom message type extension
- **WHEN** a plugin extends custom runtime messages
- **THEN** the extension MUST use the `AgentCustomMessage` declaration merging surface and produce messages compatible with the `AgentMessage` union

#### Scenario: Model message conversion boundary
- **WHEN** the runtime prepares a model request
- **THEN** it MUST convert `AgentMessage` values into `ai-sdk` compatible `ModelMessage` values only at the model-call boundary

### Requirement: Runtime Metadata Isolation
Runtime metadata for messages MUST be stored under a `meta` field and MUST NOT be scattered across top-level message fields.

#### Scenario: Constructed message id
- **WHEN** the runtime accepts a message through `append`, `send`, or `run`
- **THEN** the message MUST already be an `AgentMessage` with `meta.id` present before it is emitted, persisted, or used in model context

#### Scenario: Message id differs from entry id
- **WHEN** the runtime persists a message as an entry
- **THEN** it MUST NOT require `AgentMessage.meta.id` to equal the containing `AgentEntry.id`

#### Scenario: Turn-associated message metadata
- **WHEN** a message is submitted or generated as part of a turn
- **THEN** its `meta.turnId` MUST identify that turn

#### Scenario: Append-only observation metadata
- **WHEN** a message is appended without triggering a turn
- **THEN** its `meta.turnId` MUST be absent unless a caller explicitly provides non-runtime metadata outside the turn lifecycle

### Requirement: Custom Message Shape
Custom messages MUST use `role: 'custom'` with a plugin-specific `type` and MUST NOT introduce arbitrary top-level roles.

#### Scenario: Unknown custom message reaches model conversion
- **WHEN** no plugin converts a custom message to model messages
- **THEN** the runtime MUST ignore that custom message for model input rather than inventing a model role

### Requirement: Append Without Response
The runtime MUST expose an `append()` operation that persists messages without creating or triggering a model turn.

#### Scenario: Observed event is recorded without reply
- **WHEN** a caller invokes `append(message)`
- **THEN** the runtime MUST persist the message through the append pipeline and MUST NOT start model execution

### Requirement: Turn Invocation API
The runtime MUST expose separate `send()`, `run()`, and `waitTurn()` operations for turn execution.

#### Scenario: Fire-and-forget send
- **WHEN** a caller invokes `send(message)`
- **THEN** the runtime MUST synchronously return a `turnId` and execute the turn asynchronously

#### Scenario: Streamed run
- **WHEN** a caller invokes `run(message)`
- **THEN** the runtime MUST return a stream scoped to the created turn

#### Scenario: Wait for retained result
- **WHEN** a caller invokes `waitTurn(turnId)` for a retained completed turn
- **THEN** the runtime MUST immediately resolve the retained `TurnResult`

### Requirement: Turn Result Semantics
`waitTurn()` MUST resolve a `TurnResult` for done, failed, and aborted turns, and MUST reject only for unknown or expired turn ids or wait cancellation.

#### Scenario: Failed turn wait
- **WHEN** a turn fails during model execution
- **THEN** `waitTurn(turnId)` MUST resolve a `TurnResult` with status `failed` and error details

#### Scenario: Unknown turn wait
- **WHEN** a caller waits for a turn id outside pending, running, or retained completed turns
- **THEN** `waitTurn(turnId)` MUST reject with a turn-not-found error

### Requirement: Step-Level Output Persistence
The runtime MUST persist complete assistant messages and tool results at step boundaries and MUST NOT persist stream deltas by default.

#### Scenario: Assistant step completes
- **WHEN** the model produces a complete assistant message for a turn
- **THEN** the runtime MUST persist that assistant message through the append pipeline with the current `turnId`

#### Scenario: Tool step completes
- **WHEN** a tool call completes and produces a tool result
- **THEN** the runtime MUST persist the tool result through the append pipeline with the current `turnId`

#### Scenario: Stream delta emitted
- **WHEN** the model emits a streaming delta
- **THEN** the runtime MUST emit the delta through the channel and MUST NOT persist it unless an audit plugin or explicit configuration handles it

### Requirement: Busy Turn Behavior
The runtime MUST support `ifBusy: 'defer' | 'join' | 'reject'` for `send()` while another turn is active, with default behavior `defer`.

#### Scenario: Busy defer
- **WHEN** an active turn exists and a caller sends with `ifBusy: 'defer'`
- **THEN** the runtime MUST enqueue a new top-level turn with a new `turnId`

#### Scenario: Busy join
- **WHEN** an active turn exists and a caller sends with `ifBusy: 'join'`
- **THEN** the runtime MUST persist the joined message with the active `turnId` and drain it after the current safe model/tool boundary

#### Scenario: Busy reject
- **WHEN** an active turn exists and a caller sends with `ifBusy: 'reject'`
- **THEN** the runtime MUST reject the send operation with an agent-busy error

### Requirement: Runtime Resource Separation
The runtime MUST treat `LanguageModel` and base `systemPrompt` as runtime resources rather than built-in persisted state.

#### Scenario: Model replacement
- **WHEN** the caller replaces the runtime model
- **THEN** the runtime MUST update the model resource without requiring that `LanguageModel` be serialized into storage

#### Scenario: Dynamic system prompt
- **WHEN** the runtime builds a model request
- **THEN** it MUST resolve the configured `systemPrompt` and plugin prompt extensions before invoking `ai-sdk`

### Requirement: Base Tool Support
The runtime MUST support base tools configured on the agent and plugin-provided tools for each model call.

#### Scenario: Tool name conflict
- **WHEN** a plugin-provided tool has the same name as a base tool or another plugin tool
- **THEN** the runtime MUST fail the model-call preparation with a tool conflict error unless an explicit override mechanism is later specified

### Requirement: Serial Tool Execution
The first runtime version MUST execute multiple model-emitted tool calls in deterministic serial order.

#### Scenario: Multiple tool calls emitted
- **WHEN** a model response contains multiple tool calls
- **THEN** the runtime MUST execute those tool calls one at a time in deterministic order

#### Scenario: Parallel execution not implied
- **WHEN** multiple tool calls are independent
- **THEN** the runtime MUST NOT execute them in parallel unless a future explicit parallel-tool capability is introduced

### Requirement: Retry Outside Core
The runtime core MUST NOT implement automatic retry policy for failed turns.

#### Scenario: Turn attempt fails
- **WHEN** a model call or tool execution causes a turn attempt to fail
- **THEN** the runtime MUST classify the error and settle the turn without automatically creating a retry turn

#### Scenario: Retry association metadata
- **WHEN** a host or plugin creates a retry turn
- **THEN** the runtime MUST allow association metadata such as `parentTurnId` or `retryOf` without owning the retry decision
