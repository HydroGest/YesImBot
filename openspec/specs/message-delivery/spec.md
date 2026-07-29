# message-delivery Specification

## Purpose

Define Gateway-owned passive delivery, normalized send results, durable failure feedback, and current-bot active sending.

## Requirements

### Requirement: Gateway-Owned Passive Delivery
Gateway MUST call the original `Session.send()` for every ChannelRuntime output; RuntimeManager and ChannelRuntime MUST NOT receive a Session or Session-bound send capability. A segment MUST be delivered as an ordered element list rather than a plain string, so structured elements survive to the platform. One assistant message MAY produce multiple ordered outputs, and Gateway MUST send them in the order produced.

#### Scenario: Runtime yields output
- **WHEN** Gateway receives a ChannelRuntime output
- **THEN** it MUST send it through the active Session without waiting for the full turn

#### Scenario: One assistant message produces several outputs
- **WHEN** one assistant message parses into several segments
- **THEN** Gateway MUST send each segment through the active Session in produced order
- **AND** send authority MUST remain with Gateway for every segment

#### Scenario: Segment contains a structured element
- **WHEN** a segment contains a platform element such as `<at>` or an image
- **THEN** Gateway MUST deliver it as a structured element
- **AND** it MUST NOT be flattened to its source text

### Requirement: Durable Passive Delivery Failure
A rejected passive send MUST create a same-channel `yesimbot.event` with `eventType: "delivery.failed"`, frozen `text`, turn ID, assistant message ID, and the failed segment's position and total segment count. DefaultWill MUST not trigger a new turn for it.

#### Scenario: Passive output fails
- **WHEN** `Session.send()` rejects
- **THEN** Gateway MUST route one delivery-failure EventRecord through the producing runtime and MUST not recursively create another failure

#### Scenario: Failure identifies its segment
- **WHEN** a segment of a multi-segment reply fails to send
- **THEN** the delivery-failure record MUST identify that segment's position and the total segment count

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

Gateway MUST apply a delay before each segment derived from that segment's visible character count with bounded randomness. Every segment MUST be treated uniformly; Gateway MUST NOT apply a distinct first-segment rule and MUST NOT accept any model-authored timing hint. Each delay MUST be clamped to a per-segment ceiling, and total delivery time MUST be bounded; when the total ceiling is reached, remaining segments MUST be delivered with minimum spacing rather than dropped.

#### Scenario: Multi-segment reply is paced
- **WHEN** Gateway delivers several segments
- **THEN** it MUST wait a bounded delay before each segment
- **AND** the segments MUST NOT arrive simultaneously

#### Scenario: Longer segment waits longer
- **WHEN** two segments differ in visible character count
- **THEN** the longer segment's computed delay MUST NOT be smaller than the shorter segment's, given the same configuration

#### Scenario: First segment uses the same rule
- **WHEN** Gateway delivers the first segment of a reply
- **THEN** its delay MUST be computed by the same rule as any other segment

#### Scenario: Total delivery ceiling is reached
- **WHEN** accumulated delivery time reaches the total ceiling
- **THEN** Gateway MUST deliver the remaining segments with minimum spacing
- **AND** it MUST NOT drop any remaining segment

#### Scenario: Visible length comes from segment elements
- **WHEN** a segment contains both text and non-text elements
- **THEN** the delay MUST be derived from the segment's visible text content

### Requirement: Skipped Turn Delivers Nothing

When the producing runtime reports a skipped turn, Gateway MUST deliver no message and MUST NOT emit a delivery-failure record.

#### Scenario: Runtime reports a skipped turn
- **WHEN** a turn resolves to a skip decision
- **THEN** Gateway MUST send no platform message
- **AND** it MUST release its delivery lease normally

### Requirement: Current-Bot Active Send Tool
Core MUST provide an Agent tool that sends through the current bot to an explicit channel and returns normalized success IDs or an error without selecting another bot.

#### Scenario: Active send resolves
- **WHEN** the tool's `Bot.sendMessage()` resolves with a string array
- **THEN** it MUST return the array, including an empty array, as success
