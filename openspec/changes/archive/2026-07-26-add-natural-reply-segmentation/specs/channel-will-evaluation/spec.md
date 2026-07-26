## MODIFIED Requirements

### Requirement: Successful Reply Will Notification
WillEngine MAY implement `onReply()`. Core MUST invoke it once after a turn has status `done` and has produced at least one non-empty renderable assistant message that was delivered as at least one platform message. Core MUST NOT invoke it for failed, aborted, empty-output, or skipped turns. Notification failure MUST be diagnostic-only and MUST NOT change the completed turn.

#### Scenario: Valid assistant reply completes
- **WHEN** a done turn contains at least one renderable assistant message
- **THEN** Core MUST invoke the owning channel WillEngine's `onReply()` once
- **AND** the willingness WillEngine MUST subtract configured reply cost with a floor of zero

#### Scenario: Turn has no renderable assistant output
- **WHEN** a turn fails, aborts, or completes without non-empty renderable assistant content
- **THEN** Core MUST NOT invoke `onReply()`

#### Scenario: Turn resolves to a skip decision
- **WHEN** a done turn produces a skip decision and delivers no platform message
- **THEN** Core MUST NOT invoke `onReply()`
- **AND** the willingness WillEngine MUST NOT subtract reply cost

#### Scenario: Multi-segment reply completes
- **WHEN** a done turn delivers one assistant message as several platform messages
- **THEN** Core MUST invoke `onReply()` exactly once for that turn
- **AND** it MUST NOT invoke it once per delivered segment
