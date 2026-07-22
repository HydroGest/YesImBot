## ADDED Requirements

### Requirement: Per-Channel Will Factory
The YesImBot facade MUST allow one custom `Will.Factory` to replace the core default. RuntimeManager MUST create one Will instance for each ChannelRuntime.

#### Scenario: Channel runtime is created
- **WHEN** RuntimeManager creates a ChannelRuntime
- **THEN** it MUST create that channel's Will from the active Will.Factory
- **AND** the Will instance MUST NOT be shared with another channel

#### Scenario: No custom factory is registered
- **WHEN** RuntimeManager creates a channel without a custom Will.Factory
- **THEN** it MUST use `DefaultWill`

### Requirement: Read-Only Will Evaluation
ChannelRuntime MUST call `Will.decide()` with the committed Event and read-only `Will.State`. Will MUST return the string `wait` or `trigger` and MUST NOT receive Session, Agent, storage, AssetStore, or platform-send capabilities. `recent` MUST be an ordered bounded window of the latest 32 committed Events, evicting only its oldest entry; `pending` semantics remain unchanged.

#### Scenario: Will evaluates a committed record
- **WHEN** an Event has been persisted and observed through `yesimbot/event`
- **THEN** ChannelRuntime MUST call Will with that record and current channel state
- **AND** Will MUST NOT be able to mutate runtime state through the evaluation interface

### Requirement: Wait Decision
A `wait` decision MUST retain the committed Event without starting or joining an Agent turn.

#### Scenario: Will waits
- **WHEN** Will returns `wait`
- **THEN** ChannelRuntime MUST finish handling the record without calling `Agent.run()` or `Agent.send()`

### Requirement: Trigger Decision
A `trigger` decision MUST start a turn when the Agent is idle and MUST join the active turn when the Agent is busy. One turn MUST have one Agent-internal stream consumer.

#### Scenario: Trigger on idle channel
- **WHEN** Will returns `trigger` and the channel Agent is idle
- **THEN** ChannelRuntime MUST start one Agent turn with the committed Event
- **AND** it MUST expose one message-level outbound iterable to the initiating Gateway

#### Scenario: Trigger on busy channel
- **WHEN** Will returns `trigger` and the channel Agent has an active turn
- **THEN** ChannelRuntime MUST join the Event to that turn
- **AND** it MUST NOT create another outbound iterable or stream consumer

### Requirement: Default Will Routing
`DefaultWill` MUST trigger direct messages and group messages that mention the current bot. It MUST wait for ordinary group messages, accepted non-message events, and `delivery.failed` events.

#### Scenario: Direct message is evaluated
- **WHEN** DefaultWill evaluates a direct `message` record
- **THEN** it MUST return `trigger`

#### Scenario: Ordinary group message is evaluated
- **WHEN** DefaultWill evaluates a group message that does not mention the current bot
- **THEN** it MUST return `wait`

#### Scenario: Delivery failure is evaluated
- **WHEN** DefaultWill evaluates a `delivery.failed` record
- **THEN** it MUST return `wait`

### Requirement: Typed Will Observation
Core MUST publish `yesimbot/will` after every completed Will decision. The observation MUST identify the Event and its `Will.Decision`.

#### Scenario: Will returns a decision
- **WHEN** Will evaluation completes
- **THEN** core MUST synchronously emit `yesimbot/will`
- **AND** listener failure MUST NOT change or block the decision

### Requirement: Will Factory Replacement
Changing or disposing the active custom Will.Factory MUST evict existing ChannelRuntime instances without clearing persisted history or assets. Future events MUST recreate channels with the current factory.

#### Scenario: Custom Will plugin is disposed
- **WHEN** the active Will.Factory disposer runs
- **THEN** RuntimeManager MUST stop existing channel Will and Agent instances
- **AND** it MUST preserve channel JSONL and AssetStore data
