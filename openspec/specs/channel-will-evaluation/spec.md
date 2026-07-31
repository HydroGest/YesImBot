# channel-will-evaluation Specification

## Purpose

Define how a channel runtime decides whether a committed input waits, starts a turn, or joins an active turn.

## Requirements

### Requirement: Per-Runtime Will Selection
Core MUST create one Will engine for each new ChannelRuntime from its configuration. Missing selection and `routing` MUST select routing. `willingness` MUST select willingness. Each runtime's engine state MUST be independent.

#### Scenario: Runtime uses the default engine
- **WHEN** a ChannelRuntime is created without a Will engine selection
- **THEN** it MUST use routing

#### Scenario: Runtime selects willingness
- **WHEN** a ChannelRuntime is created with `will.engine` set to `willingness`
- **THEN** it MUST use willingness with that runtime's configured controls

### Requirement: Routing Configuration
Routing configuration MUST expose only `direct`, `mention`, and `group`, each set to `wait` or `trigger`. Its defaults MUST trigger direct messages and bot mentions, and wait for ordinary group messages. Routing MUST wait for non-message inputs, including `delivery.failed`.

#### Scenario: Routing evaluates messages
- **WHEN** routing evaluates a direct message, a bot mention, and an ordinary group message
- **THEN** it MUST return `trigger`, `trigger`, and `wait` respectively by default

### Requirement: Willingness Configuration
Willingness configuration MUST expose only `probabilityThreshold`, `decayHalfLifeSeconds`, and `replyCost`. It MUST apply elapsed-time decay lazily before a message gain, increase its score for direct messages and bot mentions, sample a response probability, and never schedule a timer. It MUST wait for non-message inputs.

#### Scenario: Message arrives after idle time
- **WHEN** a later message arrives after an earlier willingness decision
- **THEN** the engine MUST account for elapsed time before deciding on the new message

#### Scenario: Willingness handles non-message input
- **WHEN** willingness evaluates a non-message input
- **THEN** it MUST return `wait` without sampling a response probability

#### Scenario: Willingness calculation fails
- **WHEN** willingness cannot calculate a decision
- **THEN** it MUST emit a calculation diagnostic and return `wait`

### Requirement: Committed Input Decision
ChannelRuntime MUST evaluate Will after persisting and publishing every input accepted through the ordinary routed-input path. A decision MUST be either `wait` or `trigger`; `wait` MUST not start or join an Agent turn. This requirement MUST NOT apply to a trusted forced EventRecord.

#### Scenario: Will waits
- **WHEN** Will returns `wait` for an ordinarily routed input
- **THEN** ChannelRuntime MUST retain the input without calling `Agent.run()` or `Agent.send()`

#### Scenario: Will triggers an idle runtime
- **WHEN** Will returns `trigger` for an ordinarily routed input while the Agent is idle
- **THEN** ChannelRuntime MUST start one turn and expose its output

#### Scenario: Will triggers a busy runtime
- **WHEN** Will returns `trigger` for an ordinarily routed input while the Agent has an active turn
- **THEN** ChannelRuntime MUST join the input to that turn without exposing another output

### Requirement: Forced Event Bypass
ChannelRuntime MUST support a trusted forced EventRecord path that appends and publishes the event through the channel FIFO without invoking WillEngine. An idle runtime MUST start one Agent turn for that event. A busy runtime MUST join the event to its active turn without producing another output iterable.

#### Scenario: Forced event starts an idle runtime
- **WHEN** a trusted trigger appends an EventRecord to an idle ChannelRuntime
- **THEN** ChannelRuntime MUST start one Agent turn without calling `WillEngine.decide()`
- **AND** Core MUST NOT publish `yesimbot/will` for that EventRecord

#### Scenario: Forced event joins a busy runtime
- **WHEN** a trusted trigger appends an EventRecord to a ChannelRuntime with an active turn
- **THEN** ChannelRuntime MUST join it to the active turn
- **AND** Core MUST NOT create a second stream consumer or output iterable

### Requirement: Will Observation And Reply Notification
Core MUST publish `yesimbot/will` after each completed Will decision. When either passive or autonomous delivery successfully sends the first segment of a turn, Core MUST notify that runtime's Will engine once. Core MUST NOT notify Will for failed, aborted, skipped, or undelivered turns.

#### Scenario: First output is delivered
- **WHEN** Gateway or the trusted trigger path successfully delivers the first segment of a turn
- **THEN** willingness MUST apply its configured reply cost with a floor of zero

#### Scenario: Delivery is not acknowledged
- **WHEN** a turn fails, aborts, is skipped, or delivers no segment
- **THEN** Core MUST NOT notify Will
