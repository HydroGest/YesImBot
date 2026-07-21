## ADDED Requirements

### Requirement: Channel Runtime Ownership

Core MUST place channel message classification, preparation order, Agent creation and caching, append/join/run submission, turn stream consumption, output projection, reset, and stop behind one channel runtime module. The module MUST expose message handling, channel reset, and runtime stop operations without exposing Agent handles, turn streams, or individual orchestration steps to `YesImBotService` or external plugins.

#### Scenario: Core service handles an admitted message

- **WHEN** `YesImBotService` receives a Session with a collected platform message
- **THEN** it MUST delegate the message and original Session to the channel runtime
- **AND** it MUST NOT manually compose classification, preparation, Agent submission, stream consumption, or delivery

#### Scenario: Session is an operational dependency

- **WHEN** the channel runtime handles a platform message
- **THEN** it MAY pass the original Session to platform preparation and passive delivery
- **AND** it MUST NOT read routing facts from the Session, serialize it, cache it beyond the active handle, or pass it into `agent-runtime`

#### Scenario: One run owns one stream

- **WHEN** an idle channel starts a turn with `Agent.run()`
- **THEN** the channel runtime MUST own exactly one consumer for the returned stream
- **AND** messages joined to that active turn MUST NOT create another stream consumer

## MODIFIED Requirements

### Requirement: Core Configuration

Core MUST keep first-version configuration limited to `basePath`, `chatModel`, `logLevel`, platform profiles, and deterministic message routing. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `append` or `reply`. Defaults MUST preserve direct reply, group-mention reply, and ordinary-group append. Self-message ignore MUST NOT be configurable.

#### Scenario: Resolve unified base path
- **WHEN** `basePath` is relative
- **THEN** core MUST resolve it against Koishi `ctx.baseDir`

#### Scenario: Use absolute base path
- **WHEN** `basePath` is absolute
- **THEN** core MUST use it as-is

#### Scenario: Locate core data files
- **WHEN** core needs prompt files, model configuration, channel metadata, or sessions
- **THEN** it MUST resolve `AGENTS.md`, `PERSONA.md`, and `models.json` under the unified base path
- **AND** it MUST resolve channel metadata and session files under `channels/<ChannelScopeId>/`

#### Scenario: Use default routing

- **WHEN** the user does not override message routing
- **THEN** direct and mentioned messages MUST map to `reply`
- **AND** ordinary group messages MUST map to `append`

#### Scenario: Override one routing scenario

- **WHEN** the user configures one scenario as `append` or `reply`
- **THEN** core MUST apply that action to the scenario without changing FIFO, preparation, busy-read, or submission ordering

### Requirement: Message Routing

Core MUST classify each admitted message from canonical `Platform.Message` data and the deterministic routing configuration. Core MUST derive self-message status from normalized sender and source identities, mention status from normalized elements, and directness from the canonical channel type. It MUST produce only `ignore`, `append`, or `reply` and MUST NOT consult runtime busy state during classification.

#### Scenario: Self message

- **WHEN** the canonical sender ID equals the canonical source self ID
- **THEN** core MUST classify the message as `ignore`
- **AND** it MUST NOT prepare, persist, or submit that message

#### Scenario: Scenario configured as append

- **WHEN** a non-self message belongs to a scenario configured as `append`
- **THEN** core MUST prepare the platform message and call `Agent.append()`
- **AND** it MUST NOT trigger a reply by itself

#### Scenario: Scenario configured as reply while idle

- **WHEN** a non-self message belongs to a scenario configured as `reply` and the channel has no active turn after preparation
- **THEN** core MUST process the platform message through `Agent.run()`
- **AND** the channel runtime MUST consume the returned turn stream

#### Scenario: Scenario configured as reply while busy

- **WHEN** a non-self message belongs to a scenario configured as `reply` and the channel has an active turn after preparation
- **THEN** core MUST call `Agent.send(message, { ifBusy: "join" })`
- **AND** the joined input MUST use the existing turn's stream owner

#### Scenario: Adapter refines canonical message facts

- **WHEN** the selected adapter returns a refined platform message during collection
- **THEN** runtime identity, Agent context, sender checks, mention checks, and persistence MUST use the refined message
- **AND** core MUST NOT restore conflicting values from the raw Session

### Requirement: FIFO Channel Message Lifecycle

For each admitted channel input, the channel runtime MUST serialize static classification, message preparation, channel Agent resolution, the final runtime busy read, and the initial append/send/run submission in the per-channel FIFO. Static classification MUST produce `ignore`, `append`, or `reply` without consulting busy state. The runtime MUST return immediately for `ignore`. For `reply`, it MUST read `Agent.getActiveTurnId()` after preparation and immediately before submission, with no await between that read and `send(message, { ifBusy: "join" })` or `run(message)`. Model stream consumption, output projection, delivery, and terminal stream handling MUST occur outside the FIFO.

#### Scenario: Two messages arrive in one channel

- **WHEN** two eligible messages arrive for the same channel
- **THEN** core MUST complete the first message's preparation and initial submission before starting the second message's preparation
- **AND** core MUST make each reply's busy decision only after its preparation completes
- **AND** core MUST allow model turn stream consumption and delivery to proceed outside the lifecycle lock

#### Scenario: Messages arrive in different channels

- **WHEN** eligible messages arrive for different channel scope IDs
- **THEN** one channel's lifecycle FIFO MUST NOT serialize the other channel's preparation or initial submission

### Requirement: Assistant Reply Rendering

Core MUST collect all non-empty assistant text messages produced by a reply turn, project them into ordered Koishi fragments, and submit them to DeliveryService through the original Session. The channel runtime MUST own stream consumption and MUST NOT call `session.send()` directly.

#### Scenario: Multiple assistant texts from run stream

- **WHEN** a reply turn emits one or more turn-scoped `message.appended` events whose message role is `assistant` and text is non-empty
- **THEN** core MUST preserve generation order when projecting those messages
- **AND** it MUST submit the ordered outputs to passive delivery exactly once for that turn

#### Scenario: Empty or non-assistant output

- **WHEN** the turn stream contains empty assistant text, tool messages, or non-text content only
- **THEN** core MUST NOT submit those outputs as channel replies

#### Scenario: Failed turn during stream consumption

- **WHEN** the turn stream yields `turn.failed`
- **THEN** the channel runtime MUST treat the reply processing as failed
- **AND** it MUST follow the error-handling requirement for reply turns

### Requirement: Error Handling

Core MUST keep first-version user-visible errors minimal, log channel processing failures, and route any user-visible error output through DeliveryService. Delivery failure MUST NOT roll back an Agent or storage operation that already completed.

#### Scenario: Reply turn failure

- **WHEN** a message classified as `reply` fails during preparation, Agent submission, or stream consumption
- **THEN** core MUST log the failure
- **AND** it MAY ask DeliveryService to send one generic development-time error message through the original Session

#### Scenario: Ordinary append failure

- **WHEN** a message classified as `append` fails
- **THEN** core MUST log the failure
- **AND** it MUST NOT send a proactive channel reply

#### Scenario: Error reply delivery fails

- **WHEN** delivery of the generic error output fails
- **THEN** core MUST log the delivery failure
- **AND** it MUST NOT attempt another user-visible error delivery

### Requirement: Runtime Disposal

Core MUST stop accepting new channel runtime operations, interrupt and stop known channel Agents, wait for owned turn stream consumers to terminate, and clear the runtime cache during Koishi disposal. Disposal MUST NOT clear persisted channel history or assets.

#### Scenario: Koishi dispose

- **WHEN** Koishi disposes the core plugin
- **THEN** the channel runtime MUST reject new handle and reset operations
- **AND** it MUST attempt to interrupt and stop each cached Agent
- **AND** it MUST wait for owned stream consumers to terminate and clear the runtime cache

#### Scenario: Persisted data during disposal

- **WHEN** runtime disposal completes
- **THEN** core MUST preserve channel JSONL history and channel assets
