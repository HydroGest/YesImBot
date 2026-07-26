## MODIFIED Requirements

### Requirement: Gateway-Owned Passive Delivery
Gateway MUST call the original `Session.send()` for every ChannelRuntime output; RuntimeManager and ChannelRuntime MUST NOT receive a Session or Session-bound send capability. One assistant message MAY produce multiple ordered outputs, and Gateway MUST send them in the order produced.

#### Scenario: Runtime yields output
- **WHEN** Gateway receives a ChannelRuntime output
- **THEN** it MUST send it through the active Session without waiting for the full turn

#### Scenario: One assistant message produces several outputs
- **WHEN** one assistant message parses into several segments
- **THEN** Gateway MUST send each segment through the active Session in produced order
- **AND** send authority MUST remain with Gateway for every segment

### Requirement: Durable Passive Delivery Failure
A rejected passive send MUST create a same-channel `yesimbot.event` with `schemaVersion: 1`, `eventType: "delivery.failed"`, frozen `text`, turn ID, assistant message ID, and the failed segment's position and total segment count. DefaultWill MUST not trigger a new turn for it.

#### Scenario: Passive output fails
- **WHEN** `Session.send()` rejects
- **THEN** Gateway MUST route one delivery-failure EventRecord through the producing runtime and MUST not recursively create another failure

#### Scenario: Failure identifies its segment
- **WHEN** a segment of a multi-segment reply fails to send
- **THEN** the delivery-failure record MUST identify that segment's position and the total segment count

## ADDED Requirements

### Requirement: Stop On First Segment Failure

When a segment of a multi-segment reply fails to send, Gateway MUST stop sending the remaining segments of that reply. Gateway MUST NOT retry a failed segment, and MUST NOT recall or edit already delivered segments.

#### Scenario: Middle segment fails
- **WHEN** the second of four segments fails to send
- **THEN** Gateway MUST NOT send the third or fourth segment
- **AND** it MUST emit exactly one delivery-failure record for the failed segment

#### Scenario: Send rejection is not retried
- **WHEN** a segment send rejects
- **THEN** Gateway MUST NOT attempt that send again
- **AND** it MUST NOT produce a duplicate platform message

#### Scenario: Earlier segments remain delivered
- **WHEN** delivery stops after a failure
- **THEN** already delivered segments MUST remain delivered
- **AND** Gateway MUST NOT attempt to recall or delete them

### Requirement: Abort Between Segments

Gateway MUST check for cancellation before each inter-segment delay and again before each segment send. On cancellation, Gateway MUST stop sending remaining segments, MUST NOT recall delivered segments, and MUST NOT emit a delivery-failure record for the cancellation.

#### Scenario: Turn is cancelled during delivery
- **WHEN** the turn is cancelled after the first segment is delivered
- **THEN** Gateway MUST NOT send the remaining segments
- **AND** it MUST NOT emit a delivery-failure record for the cancelled segments

#### Scenario: Cancellation during an inter-segment delay
- **WHEN** cancellation occurs while waiting between segments
- **THEN** Gateway MUST abandon the wait and stop delivery

#### Scenario: New input arrives during delivery
- **WHEN** delivery is in progress and the runtime cancels the turn for new input
- **THEN** delivery MUST stop at the current segment boundary

### Requirement: Bounded Human-Like Pacing

Gateway MUST apply a delay before each segment derived from that segment's visible character count with bounded randomness, plus the sum of that segment's `<sleep>` hints. The first segment's delay MUST subtract already-elapsed model generation time while retaining a bounded random residual. Each segment's delay MUST be clamped to a per-segment ceiling, and total delivery time MUST be bounded; when the total ceiling is reached, remaining segments MUST be delivered with minimum spacing rather than dropped.

#### Scenario: Multi-segment reply is paced
- **WHEN** Gateway delivers several segments
- **THEN** it MUST wait a bounded delay before each segment
- **AND** the segments MUST NOT arrive simultaneously

#### Scenario: Generation already consumed wall clock
- **WHEN** model generation took longer than the computed first-segment delay
- **THEN** Gateway MUST reduce that delay by the elapsed time
- **AND** it MUST retain a bounded random residual delay rather than sending instantly

#### Scenario: Sleep hint extends a pause
- **WHEN** a segment carries a `<sleep>` hint
- **THEN** Gateway MUST add the hint to that segment's computed delay
- **AND** the result MUST be clamped to the per-segment ceiling

#### Scenario: Total delivery ceiling is reached
- **WHEN** accumulated delivery time reaches the total ceiling
- **THEN** Gateway MUST deliver the remaining segments with minimum spacing
- **AND** it MUST NOT drop any remaining segment

### Requirement: Skipped Turn Delivers Nothing

When the producing runtime reports a skipped turn, Gateway MUST deliver no message and MUST NOT emit a delivery-failure record.

#### Scenario: Runtime reports a skipped turn
- **WHEN** a turn resolves to a skip decision
- **THEN** Gateway MUST send no platform message
- **AND** it MUST release its delivery lease normally
