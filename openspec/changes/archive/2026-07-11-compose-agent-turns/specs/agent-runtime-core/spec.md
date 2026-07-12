## MODIFIED Requirements

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

### Requirement: Busy Behavior

The runtime MUST support `ifBusy: 'defer' | 'join' | 'reject'` for `send()` and `run()` while another turn is active, with default behavior `defer`.

#### Scenario: Defer creates a queued turn

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'defer'`
- **THEN** the runtime MUST create a new turn id and queue it behind the active turn

#### Scenario: Join attaches to the active turn

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'join'`
- **THEN** the runtime MUST return the active turn id
- **AND** the message MUST enter the active turn as explicit joined input rather than only as passive history

#### Scenario: Reject fails fast

- **WHEN** an active turn exists and a caller sends with `ifBusy: 'reject'`
- **THEN** the runtime MUST throw a busy error without queueing or joining

### Requirement: Interrupt Semantics

The runtime MUST allow interrupting the active turn and MUST settle that turn as aborted through turn-scoped events.

#### Scenario: Interrupt active turn

- **WHEN** a caller invokes `interrupt()` while a turn is active
- **THEN** the runtime MUST abort the active turn execution
- **AND** it MUST emit a turn-scoped `turn.aborted` event for that turn

#### Scenario: Later turns remain usable

- **WHEN** an interrupted turn has settled
- **THEN** the runtime MUST remain initialized and able to accept later `append()`, `send()`, `run()`, and `wait()` operations

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

## REMOVED Requirements

### Requirement: Turn Result Semantics

**Reason**: Public completion no longer returns retained `TurnResult` values through `waitTurn`. Completion is observed through turn-scoped events; structured `TurnResult` may remain only for plugin finish hooks.

**Migration**: Replace `await agent.waitTurn(turnId)` with either consuming `agent.run(message)` until a terminal turn event, or awaiting `agent.wait()` when only an idle barrier is needed. Read outputs from turn-scoped `message.appended` events instead of `TurnResult.messages`.
