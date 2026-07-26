# channel-will-evaluation Specification

## Purpose

Define how ChannelRuntime evaluates a per-channel WillEngine instance to decide whether a committed Event starts a turn, joins an active turn, or waits without Agent action.

## Requirements

### Requirement: Configured WillEngine Construction
Core MUST construct each ChannelRuntime's internal WillEngine from that runtime's frozen configuration through `createWillEngine(config, diagnostics)`. The factory MUST synchronously select either the routing or willingness engine, MUST default to routing when no engine is configured, and MUST NOT receive a Session, ChannelScope, Agent, storage, AssetStore, or platform-send capability. Each ChannelRuntime MUST own a distinct WillEngine instance.

#### Scenario: Channel runtime is created with no engine selection
- **WHEN** RuntimeManager creates a ChannelRuntime without an engine selection
- **THEN** it MUST construct a distinct routing WillEngine for that channel
- **AND** it MUST NOT share that engine with another ChannelRuntime

#### Scenario: Willingness engine is selected
- **WHEN** RuntimeManager creates a ChannelRuntime whose frozen configuration selects `willingness`
- **THEN** it MUST construct a distinct willingness WillEngine for that channel

### Requirement: Read-Only Will Evaluation
ChannelRuntime MUST call `WillEngine.decide()` with the committed Event and read-only `WillEngine.State`. WillEngine MUST return the string `wait` or `trigger` and MUST NOT receive Session, Agent, storage, AssetStore, or platform-send capabilities. `WillEngine.State` MUST contain only `activeTurnId`.

#### Scenario: WillEngine evaluates a committed record
- **WHEN** an Event has been persisted and observed through `yesimbot/event`
- **THEN** ChannelRuntime MUST call WillEngine with that record and the current `activeTurnId`
- **AND** WillEngine MUST NOT be able to mutate runtime state through the evaluation interface

### Requirement: Wait Decision
A `wait` decision MUST retain the committed Event without starting or joining an Agent turn.

#### Scenario: WillEngine waits
- **WHEN** WillEngine returns `wait`
- **THEN** ChannelRuntime MUST finish handling the record without calling `Agent.run()` or `Agent.send()`

### Requirement: Trigger Decision
A `trigger` decision MUST start a turn when the Agent is idle and MUST join the active turn when the Agent is busy. One turn MUST have one Agent-internal stream consumer.

#### Scenario: Trigger on idle channel
- **WHEN** WillEngine returns `trigger` and the channel Agent is idle
- **THEN** ChannelRuntime MUST start one Agent turn with the committed Event
- **AND** it MUST expose one message-level outbound iterable to the initiating Gateway

#### Scenario: Trigger on busy channel
- **WHEN** WillEngine returns `trigger` and the channel Agent has an active turn
- **THEN** ChannelRuntime MUST join the Event to that turn
- **AND** it MUST NOT create another outbound iterable or stream consumer

### Requirement: Default Will Routing
The routing WillEngine MUST trigger direct messages and group messages that mention the current bot. It MUST wait for ordinary group messages, accepted non-message events, and `delivery.failed` events. It MUST remain the Core default unless `willingness` is explicitly selected.

#### Scenario: Direct message is evaluated
- **WHEN** the routing WillEngine evaluates a direct `message` record
- **THEN** it MUST return `trigger`

#### Scenario: Ordinary group message is evaluated
- **WHEN** the routing WillEngine evaluates a group message that does not mention the current bot
- **THEN** it MUST return `wait`

#### Scenario: Delivery failure is evaluated
- **WHEN** the routing WillEngine evaluates a `delivery.failed` record
- **THEN** it MUST return `wait`

### Requirement: Typed Will Observation
Core MUST publish `yesimbot/will` after every completed WillEngine decision. The observation MUST identify the Event and its `WillEngine.Decision`.

#### Scenario: WillEngine returns a decision
- **WHEN** WillEngine evaluation completes
- **THEN** core MUST synchronously emit `yesimbot/will`
- **AND** listener failure MUST NOT change or block the decision

### Requirement: Core Will Engine Selection
Core configuration MUST select `routing` or `willingness` as the default WillEngine for newly created ChannelRuntimes. Missing engine configuration MUST select `routing`.

#### Scenario: Engine is not configured
- **WHEN** RuntimeManager creates a ChannelRuntime without an engine selection
- **THEN** it MUST construct the deterministic routing WillEngine

#### Scenario: Willingness is selected
- **WHEN** Core configuration selects `willingness`
- **THEN** RuntimeManager MUST construct one temporary willingness WillEngine for that ChannelRuntime

### Requirement: Temporary Static Willingness Evaluation
The temporary willingness WillEngine MUST use one score and timestamps per ChannelRuntime and MUST evaluate message Events from static runtime configuration without receiving Session. It MUST support v3-derived text base gain, self-mention and direct-message bonuses, keyword and default multipliers, bounded score, response threshold, probability amplifier, and random sampling. It MUST omit quote scoring and MUST return `wait` for non-message Events.

#### Scenario: Message gain is evaluated
- **WHEN** the willingness WillEngine receives a committed message Event
- **THEN** it MUST apply configured message attributes and interest multiplier to the channel score
- **AND** it MUST return `trigger` exactly when the sampled value is below the bounded response probability

#### Scenario: Non-message event is evaluated
- **WHEN** the willingness WillEngine receives a non-message or `delivery.failed` Event
- **THEN** it MUST return `wait` without adding message gain

#### Scenario: Calculation fails
- **WHEN** willingness calculation encounters an invalid runtime condition
- **THEN** the WillEngine MUST record a distinct diagnostic and fail closed to `wait`

### Requirement: Lazy Willingness Decay
The willingness WillEngine MUST apply O(1) elapsed-time exponential decay before each message gain. It MUST weight elapsed silence at `0.3` for the first 15 seconds after the previous message, `0.7` from 15 through 60 seconds, and `1.0` after 60 seconds. A score above the probability threshold MUST decay at half rate until it reaches the threshold, after which normal decay applies. The pure calculation MUST use the configured half-life, MUST clamp a result below `0.01` or below zero to zero, and MUST NOT create a periodic timer.

#### Scenario: Channel is idle between messages
- **WHEN** a later message arrives after elapsed time
- **THEN** the WillEngine MUST decay the prior score from stored timestamps before applying the new gain

#### Scenario: Decay crosses the probability threshold
- **WHEN** weighted elapsed time is sufficient for an above-threshold score to reach and pass the threshold
- **THEN** the WillEngine MUST apply half-rate decay only until the threshold crossing
- **AND** it MUST apply normal half-life decay to the remaining weighted time

#### Scenario: Runtime stops
- **WHEN** ChannelRuntime stops the willingness WillEngine
- **THEN** no decay timer or global per-channel map MUST remain to clean up

### Requirement: Successful Reply Will Notification
WillEngine MAY implement `onReply()`. Core MUST invoke it once after a turn has status `done` and has produced at least one non-empty renderable assistant message. Core MUST NOT invoke it for failed, aborted, or empty-output turns. Notification failure MUST be diagnostic-only and MUST NOT change the completed turn.

#### Scenario: Valid assistant reply completes
- **WHEN** a done turn contains at least one renderable assistant message
- **THEN** Core MUST invoke the owning channel WillEngine's `onReply()` once
- **AND** the willingness WillEngine MUST subtract configured reply cost with a floor of zero

#### Scenario: Turn has no renderable assistant output
- **WHEN** a turn fails, aborts, or completes without non-empty renderable assistant content
- **THEN** Core MUST NOT invoke `onReply()`
