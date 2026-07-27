## MODIFIED Requirements

### Requirement: Successful Reply Will Notification
WillEngine MAY implement `onReply()`. Core MUST invoke it exactly once per turn whose
delivery was acknowledged, where acknowledgement means Gateway successfully sent at
least one segment of that turn to the platform. Core MUST NOT invoke it for failed,
aborted, or skipped turns, or for turns whose delivery was never acknowledged. Core
MUST NOT re-derive renderable content to make this decision. Notification failure
MUST be diagnostic-only and MUST NOT change the completed turn.

#### Scenario: Delivery is acknowledged
- **WHEN** Gateway successfully sends the first segment of a turn
- **THEN** Core MUST invoke the owning channel WillEngine's `onReply()` once
- **AND** the willingness WillEngine MUST subtract configured reply cost with a floor of zero

#### Scenario: Several segments are delivered for one turn
- **WHEN** a turn delivers more than one segment successfully
- **THEN** Core MUST invoke `onReply()` exactly once for that turn

#### Scenario: Turn produces no delivered message
- **WHEN** a turn fails, aborts, is skipped, or produces no delivered segment
- **THEN** Core MUST NOT invoke `onReply()`
- **AND** the willingness WillEngine MUST NOT subtract reply cost

#### Scenario: First send fails
- **WHEN** the first `Session.send()` for a turn throws
- **THEN** Core MUST NOT invoke `onReply()` for that turn

### Requirement: Configured WillEngine Construction
Core MUST construct each ChannelRuntime's internal WillEngine from that runtime's
frozen configuration through `createWillEngine(config, diagnostics)`. The factory
MUST synchronously select either the routing or willingness engine, MUST default to
routing when no engine is configured, and MUST NOT receive a Session, ChannelScope,
Agent, storage, AssetStore, or platform-send capability. Each ChannelRuntime MUST own
a distinct WillEngine instance. Willingness configuration MUST be validated exactly
once at construction; Core MUST NOT revalidate it on each decision or reply
notification, and invalid configuration MUST fail construction rather than degrade
silently per call.

#### Scenario: Channel runtime is created with no engine selection
- **WHEN** RuntimeManager creates a ChannelRuntime without an engine selection
- **THEN** it MUST construct a distinct routing WillEngine for that channel
- **AND** it MUST NOT share that engine with another ChannelRuntime

#### Scenario: Willingness engine is selected
- **WHEN** RuntimeManager creates a ChannelRuntime whose frozen configuration selects `willingness`
- **THEN** it MUST construct a distinct willingness WillEngine for that channel
- **AND** its configuration MUST be validated once during construction

#### Scenario: Invalid willingness configuration
- **WHEN** willingness configuration contains a non-finite or out-of-range value
- **THEN** construction MUST fail

#### Scenario: Decision is evaluated
- **WHEN** a willingness WillEngine evaluates a decision
- **THEN** it MUST reuse the configuration validated at construction
- **AND** it MUST NOT revalidate it
