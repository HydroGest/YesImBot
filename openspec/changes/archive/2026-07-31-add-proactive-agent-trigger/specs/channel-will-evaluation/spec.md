# channel-will-evaluation Specification Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Will Observation And Reply Notification

Core MUST publish `yesimbot/will` after each completed Will decision. When either passive or autonomous delivery successfully sends the first segment of a turn, Core MUST notify that runtime's Will engine once. Core MUST NOT notify Will for failed, aborted, skipped, or undelivered turns.

#### Scenario: First output is delivered

- **WHEN** Gateway or the trusted trigger path successfully delivers the first segment of a turn
- **THEN** willingness MUST apply its configured reply cost with a floor of zero

#### Scenario: Delivery is not acknowledged

- **WHEN** a turn fails, aborts, is skipped, or delivers no segment
- **THEN** Core MUST NOT notify Will
