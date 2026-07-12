# agent-runtime-core Specification

## Purpose

Define the core runtime API, message model, turn lifecycle, model execution, and tool execution behavior for the experimental `@yesimbot/agent-runtime` package.
## Requirements
### Requirement: Message-Centered Runtime Types

The new runtime MUST use `AgentMessage` as the core historical semantic unit and MUST NOT expose `AgentInput` or `AgentOutput` as public core concepts. `AgentMessage` MUST represent semantic message content and MUST carry message-owned `id` and `timestamp` fields. `AgentMessage` MUST NOT carry runtime turn metadata such as `meta` or `turnId`.

#### Scenario: Custom message type extension

- **WHEN** a plugin extends custom runtime messages
- **THEN** the extension MUST use the `AgentCustomMessages` declaration merging surface
- **AND** the declared value type MUST be available through `AgentCustomMessage`
- **AND** declared custom messages MUST be compatible with the `AgentMessage` union

#### Scenario: Model message conversion boundary

- **WHEN** the runtime prepares a model request
- **THEN** it MUST convert `AgentMessage` values into `ai-sdk` compatible `ModelMessage` values only at the model-call boundary

#### Scenario: Message has no runtime metadata

- **WHEN** a message is created or accepted by `append`, `send`, or `run`
- **THEN** the message MUST contain top-level `id` and `timestamp`
- **AND** the message MUST NOT be required to contain `meta` or `turnId`

### Requirement: Runtime Metadata Isolation

Message identity and message occurrence time MUST belong to `AgentMessage.id` and `AgentMessage.timestamp`. Persistent record identity and append time MUST belong to `AgentEntry.id` and `AgentEntry.timestamp`. Turn identity MUST belong to turn results, hook contexts, runtime queue state, and turn-related internal events.

Runtime-created internal events MUST be represented as `AgentInternalEvent` values with runtime-owned `id` and `timestamp`. Internal event creation inputs MUST be represented as `AgentInternalEventInit` values and MUST NOT require callers to provide `id` or `timestamp`.

#### Scenario: Constructed message has identity

- **WHEN** a message constructor creates a user, system, assistant, tool, or custom message
- **THEN** the constructed message MUST receive a top-level message id and timestamp
- **AND** the caller MAY provide either value explicitly

#### Scenario: Entry id owns persistence identity separately

- **WHEN** the runtime persists a message as an entry
- **THEN** the containing `AgentEntry.id` MUST identify the persisted record
- **AND** the `AgentMessage.id` MUST continue to identify the semantic message

#### Scenario: Turn-associated message runtime context

- **WHEN** a message is submitted or generated as part of a turn
- **THEN** the runtime MUST associate the turn through runtime state, hook context, `TurnResult.turnId`, and turn-related internal events rather than mutating the message with `turnId`

#### Scenario: Append-only observation has no turn metadata

- **WHEN** a message is appended without triggering a turn
- **THEN** the runtime MUST NOT add turn metadata to the message

### Requirement: Custom Message Shape

Custom messages MUST use `role: 'custom'` with a plugin-specific `type`, top-level message `id` and `timestamp`, and structured `data`. Custom message `data` MUST NOT be treated as direct model-visible content; it MUST become model-visible only through `toModelMessages`.

#### Scenario: Custom message construction

- **WHEN** a caller creates a custom message through `createCustomMessage(type, data)`
- **THEN** the `type` MUST be constrained to registered `role: "custom"` entries in `AgentCustomMessages`
- **AND** the `data` argument MUST be constrained to the declared custom message data type
- **AND** registered non-custom `AgentCustomMessages` entries MUST NOT be accepted by `createCustomMessage`

#### Scenario: Unknown custom message reaches model conversion

- **WHEN** no plugin converts a custom message to model messages
- **THEN** the runtime MUST ignore that custom message for model input rather than inventing a model role

### Requirement: Append Without Response

The runtime MUST expose an `append()` operation that persists messages without creating or triggering a model turn.

#### Scenario: Observed event is recorded without reply

- **WHEN** a caller invokes `append(message)`
- **THEN** the runtime MUST persist the message through the append pipeline and MUST NOT start model execution

### Requirement: Turn Invocation API

The runtime MUST expose separate `send()`, `run()`, and `wait()` operations for turn execution.

#### Scenario: Fire-and-forget send

- **WHEN** a caller invokes `send(message)`
- **THEN** the runtime MUST synchronously return a `turnId` and execute the turn asynchronously

#### Scenario: Streamed run

- **WHEN** a caller invokes `run(message)`
- **THEN** the runtime MUST create a turn equivalent to `send(message)`
- **AND** it MUST return an async iterable scoped to that turn id

#### Scenario: Idle wait barrier

- **WHEN** a caller invokes `wait()` while turns are active or queued
- **THEN** the runtime MUST resolve only after the agent becomes idle
- **AND** the resolved value MUST be `void`

#### Scenario: Wait signal cancellation

- **WHEN** a caller invokes `wait({ signal })` and the signal aborts before idle
- **THEN** the runtime MUST reject the wait promise with an abort error
- **AND** it MUST NOT cancel active turns solely because the wait was aborted

### Requirement: Turn Completion Observation

Public callers MUST observe turn completion, failure, and outputs through turn-scoped events from `run()` or channel subscriptions rather than through a retained `waitTurn(turnId)` result API.

#### Scenario: Failed turn observation

- **WHEN** a turn fails during model execution
- **THEN** the runtime MUST emit a turn-scoped `turn.failed` internal event
- **AND** a `run()` consumer for that turn MUST receive that terminal event before the iterable ends

#### Scenario: Successful turn observation

- **WHEN** a turn completes successfully
- **THEN** the runtime MUST emit a turn-scoped `turn.done` internal event
- **AND** a `run()` consumer for that turn MUST receive that terminal event before the iterable ends

#### Scenario: No retained public waitTurn API

- **WHEN** a caller inspects the public `Agent` surface
- **THEN** the runtime MUST NOT expose `waitTurn(turnId)`
- **AND** idle waiting MUST use `wait()` instead

### Requirement: Run Stream Membership

A stream returned by `run(message)` MUST yield all internal events associated with the created turn id.

#### Scenario: Turn lifecycle events are included

- **WHEN** a caller consumes `run(message)`
- **THEN** the iterable MUST include turn-scoped lifecycle events such as `turn.queued`, `turn.start`, and the terminal `turn.done`, `turn.failed`, or `turn.aborted` event

#### Scenario: Message and tool events are included

- **WHEN** the turn appends messages or executes tools
- **THEN** the iterable MUST include matching turn-scoped `message.appended` and `tool.*` internal events for that turn id

#### Scenario: Events from other turns are excluded

- **WHEN** other turns emit internal events concurrently or later
- **THEN** the iterable for one turn MUST NOT yield events whose turn id differs from the created turn

### Requirement: Step-Level Output Persistence

The runtime MUST persist complete assistant messages and tool results at step boundaries and MUST NOT persist stream deltas by default. When the underlying model SDK reports cumulative step response messages, the runtime MUST persist only the response messages that have not already been persisted for that model call.

#### Scenario: Assistant step completes

- **WHEN** the model produces a complete assistant message for a turn
- **THEN** the runtime MUST persist that assistant message through the append pipeline without writing the turn id into the message
- **AND** it MUST emit any turn-scoped append event with the current `turnId`

#### Scenario: Tool step completes

- **WHEN** a tool call completes and produces a tool result
- **THEN** the runtime MUST persist the tool result through the append pipeline as a model-compatible tool message without writing the turn id into the message
- **AND** it MUST emit any turn-scoped append event with the current `turnId`

#### Scenario: Cumulative step response messages

- **WHEN** a later tool-loop step reports response messages that include assistant messages or tool results from earlier steps in the same model call
- **THEN** the runtime MUST NOT append those earlier response messages to storage again
- **AND** later model requests MUST observe each assistant tool call and matching tool result at most once unless the model actually produced a distinct new response message

#### Scenario: Stream delta emitted

- **WHEN** the model emits a streaming delta
- **THEN** the runtime MUST emit the delta through the channel and MUST NOT persist it unless an audit plugin or explicit configuration handles it

### Requirement: Busy Behavior

The runtime MUST support `ifBusy: 'defer' | 'join' | 'reject'` for `send()` and `run()` while another turn is active, with default behavior `defer`.

#### Scenario: Defer creates a queued turn

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'defer'`
- **THEN** the runtime MUST create a new turn id and queue it behind the active turn

#### Scenario: Join attaches to the active turn

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'join'`
- **THEN** the runtime MUST return the active turn id
- **AND** the message MUST enter the active turn as explicit joined input and drain after the current safe model/tool boundary
- **AND** it MUST NOT write the active turn id into the joined message

#### Scenario: Reject fails fast

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'reject'`
- **THEN** the runtime MUST throw a busy error without queueing or joining

### Requirement: Runtime Resource Separation

The runtime MUST treat `LanguageModel` and base `systemPrompt` as runtime resources rather than built-in persisted state.

#### Scenario: Model replacement

- **WHEN** the caller replaces the runtime model
- **THEN** the runtime MUST update the model resource without requiring that `LanguageModel` be serialized into storage

#### Scenario: Dynamic system prompt

- **WHEN** the runtime builds a model request
- **THEN** it MUST resolve the configured `systemPrompt` and plugin prompt extensions before invoking `ai-sdk`

#### Scenario: Structured system prompt model input

- **WHEN** one or more active plugins append structured system prompt blocks
- **THEN** the runtime MUST pass the resolved system prompt to `ai-sdk` through the `system` option as AI SDK-compatible system input
- **AND** it MUST NOT inject those structured system prompt blocks into the model `messages` array

#### Scenario: Legacy string prompt compatibility

- **WHEN** no active plugin appends structured system prompt blocks
- **THEN** the runtime MUST continue passing the resolved legacy system prompt as a string to `ai-sdk`

#### Scenario: Structured prompt without base string

- **WHEN** no base `systemPrompt` is configured and one or more active plugins append structured system prompt blocks
- **THEN** the runtime MUST still pass those structured blocks through AI SDK's `system` option
- **AND** it MUST NOT invoke legacy `extendSystemPrompt` without a base string prompt

### Requirement: Base Tool Support

The runtime MUST support base tools configured on the agent, stable plugin-provided tools, and opt-in dynamic tool extension for each model call.

#### Scenario: Stable tool order

- **WHEN** the runtime prepares tools for a model call
- **THEN** it MUST start from base tools configured on the agent
- **AND** it MUST append stable plugin tools resolved during plugin initialization in deterministic plugin order
- **AND** it MUST run dynamic `extendTools` hooks only when at least one active plugin implements that hook

#### Scenario: Stable tool reuse

- **WHEN** a plugin declares tools through `AgentPlugin.tools`
- **THEN** the runtime MUST reuse those tool definitions across turns rather than requiring the plugin to recreate them for each turn

#### Scenario: Tool name conflict

- **WHEN** a plugin-provided tool has the same name as a base tool or another plugin tool
- **THEN** the runtime MUST fail the model-call preparation with a tool conflict error unless an explicit override mechanism is later specified

#### Scenario: Tool execution gets turn context

- **WHEN** the model calls a tool
- **THEN** the runtime MUST pass the current `turnId`, cancellation signal, `toolCallId`, runtime id, channel, state, and storage through the tool execution context

### Requirement: Serial Tool Execution

The first runtime version MUST execute multiple model-emitted tool calls in deterministic serial order.

#### Scenario: Multiple tool calls emitted

- **WHEN** a model response contains multiple tool calls
- **THEN** the runtime MUST execute those tool calls one at a time in deterministic order

#### Scenario: Parallel execution not implied

- **WHEN** multiple tool calls are independent
- **THEN** the runtime MUST NOT execute them in parallel unless a future explicit parallel-tool capability is introduced

### Requirement: Retry Outside Core

The runtime core MUST NOT implement automatic retry policy for failed turns and MUST NOT define retry metadata fields on `AgentMessage`.

#### Scenario: Turn attempt fails

- **WHEN** a model call or tool execution causes a turn attempt to fail
- **THEN** the runtime MUST classify the error and settle the turn without automatically creating a retry turn

#### Scenario: Retry association outside message metadata

- **WHEN** a host or plugin creates a retry turn
- **THEN** retry association MUST be modeled outside core `AgentMessage` metadata, such as through caller-owned custom messages, custom entries, or future explicit retry capability

### Requirement: Interrupt Semantics

The runtime MUST allow interrupting the active turn without clearing storage or stopping the runtime, and MUST settle that turn as aborted through turn-scoped events.

#### Scenario: Interrupt active turn

- **WHEN** a caller invokes `interrupt()` while a turn is active
- **THEN** the runtime MUST abort the active model call and tool execution
- **AND** it MUST emit a turn-scoped `turn.aborted` event for that turn

#### Scenario: Interrupt without active turn

- **WHEN** a caller invokes `interrupt()` and no turn is active
- **THEN** the runtime MUST complete without error

#### Scenario: Interruption preserves history

- **WHEN** a turn is interrupted after messages or tool results have already been persisted
- **THEN** the runtime MUST NOT roll back those persisted entries
- **AND** it MUST persist or emit the aborted terminal event according to runtime event persistence rules

#### Scenario: Later turns remain usable

- **WHEN** an interrupted turn has settled
- **THEN** the runtime MUST remain initialized and able to accept later `append()`, `send()`, `run()`, and `wait()` operations

### Requirement: Active Turn Observation Visibility

The runtime MUST make messages appended during an active turn visible to that turn at the next safe model boundary without treating those messages as joined explicit input.

#### Scenario: Append observation during active turn

- **WHEN** a caller invokes `append(message)` while a turn is active
- **THEN** the runtime MUST persist the message through the append pipeline
- **AND** the append operation MUST NOT create a new top-level turn
- **AND** the runtime MUST NOT write the active turn id into the message

#### Scenario: Observation reaches next safe model boundary

- **WHEN** an appended observation is persisted during an active turn before a later model request is prepared for that same turn
- **THEN** the runtime MUST include that observation in the model context for the later model request

#### Scenario: Observation preserves append order

- **WHEN** appended observations, assistant messages, and tool results are persisted during the same active turn
- **THEN** the runtime MUST preserve append-only storage order when constructing later model context
- **AND** it MUST NOT reorder those messages by timestamp

#### Scenario: Observation differs from join

- **WHEN** a message is appended during an active turn
- **THEN** the runtime MUST NOT treat it as a joined current input message
- **AND** it MUST NOT force another model request solely because the message was appended

#### Scenario: Joined input remains explicit

- **WHEN** a caller sends a message with `ifBusy: "join"` during an active turn
- **THEN** the runtime MUST continue to treat that message as explicit joined input for the active turn

### Requirement: UUID Runtime Identifiers

The runtime MUST generate default identifiers with UUIDs rather than process-local prefixed counters.

#### Scenario: Generated message id

- **WHEN** a message constructor is called without an explicit id
- **THEN** the message id MUST be a UUID generated by the runtime

#### Scenario: Generated turn id

- **WHEN** a caller invokes `send(message)` or `run(message)`
- **THEN** the returned `turnId` MUST be a UUID generated by the runtime

#### Scenario: Generated entry id

- **WHEN** the runtime creates an `AgentEntry`
- **THEN** the entry id MUST be a UUID generated by the runtime unless the caller explicitly provides an id

### Requirement: Compositional Agent Interface

The runtime MUST expose `createAgent()` through a compositional `Agent` interface and MUST NOT expose `AgentRuntime` as the public runtime type.

#### Scenario: Agent facade composition

- **WHEN** a caller creates an agent
- **THEN** the returned object MUST expose nested `channel`, `storage`, and `state`
- **AND** it MUST expose turn operations `send`, `run`, `wait`, `interrupt`, `getActiveTurnId`, and `isIdle`
- **AND** it MUST expose lifecycle/message operations such as `init`, `stop`, `clear`, and `append`

#### Scenario: No channel method lifting

- **WHEN** a caller uses the public `Agent` type
- **THEN** event bus methods MUST remain on `agent.channel`
- **AND** the top-level agent MUST NOT be required to implement channel `emit` / `subscribe` directly

#### Scenario: No Runner abstraction requirement

- **WHEN** the runtime executes a model turn
- **THEN** it MUST use AI SDK execution directly inside the agent/turn pipeline
- **AND** it MUST NOT require a public `Runner` type for normal operation

#### Scenario: AgentRuntime removed

- **WHEN** a caller imports public runtime types from the package
- **THEN** `AgentRuntime` MUST NOT be exported

### Requirement: Built-In Terminal Tool

The runtime MUST support an optional built-in terminal tool that lets a model mark a turn as finalized after emitting user-visible text and any required tool calls.

#### Scenario: Terminal tool is enabled by config

- **WHEN** an Agent is created with terminal tool support enabled
- **THEN** the runtime MUST include a built-in terminal tool in the visible tool set
- **AND** the tool MUST be available alongside base tools and plugin-provided tools

#### Scenario: Terminal tool is disabled by default at runtime package boundary

- **WHEN** an Agent is created without terminal tool support enabled
- **THEN** the runtime package MUST NOT add the built-in terminal tool

#### Scenario: Terminal tool input and output are minimal

- **WHEN** the model calls the terminal tool
- **THEN** the tool MUST accept an empty object input
- **AND** it MUST return a small success result indicating finalization
- **AND** it MUST NOT require user-visible text, memory content, or application data as arguments

#### Scenario: Terminal tool stops the loop without failing the turn

- **WHEN** the model calls the terminal tool during a tool loop
- **THEN** the runtime MUST stop further generation after that step
- **AND** the turn MUST settle as `done` unless another error occurs
- **AND** the terminal tool MUST NOT throw or abort solely to stop the loop

#### Scenario: Terminal tool name conflicts are handled

- **WHEN** a base tool or plugin tool uses the same name as the configured terminal tool
- **THEN** the runtime MUST fail model-call preparation with the existing tool conflict behavior rather than silently overwriting a tool

### Requirement: Terminal Tool Configuration

The runtime MUST expose a narrow Agent configuration surface for terminal tool support without exposing provider-specific internals to callers.

#### Scenario: Default terminal tool name

- **WHEN** terminal tool support is enabled without a custom name
- **THEN** the runtime MUST use `finalize_response` as the tool name

#### Scenario: Custom terminal tool name

- **WHEN** terminal tool support is enabled with a custom name
- **THEN** the runtime MUST register the terminal tool under that name
- **AND** loop-stop behavior MUST track the configured name

#### Scenario: Terminal stop condition composes with natural loop completion

- **WHEN** terminal tool support is enabled
- **THEN** the runtime MUST still complete naturally when the model stops making tool calls
- **AND** it MUST also stop when the configured terminal tool is called
---
