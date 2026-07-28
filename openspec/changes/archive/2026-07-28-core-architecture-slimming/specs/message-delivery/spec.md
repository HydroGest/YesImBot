## MODIFIED Requirements

### Requirement: Gateway-Owned Passive Delivery
Gateway MUST call the original `Session.send()` for every ChannelRuntime output;
RuntimeManager and ChannelRuntime MUST NOT receive a Session or Session-bound send
capability. A segment MUST be delivered as an ordered element list rather than a
plain string, so structured elements survive to the platform. One assistant message
MAY produce multiple ordered outputs, and Gateway MUST send them in the order
produced.

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

### Requirement: Bounded Human-Like Pacing

Gateway MUST apply a delay before each segment derived from that segment's visible
character count with bounded randomness. Every segment MUST be treated uniformly;
Gateway MUST NOT apply a distinct first-segment rule and MUST NOT accept any
model-authored timing hint. Each delay MUST be clamped to a per-segment ceiling, and
total delivery time MUST be bounded; when the total ceiling is reached, remaining
segments MUST be delivered with minimum spacing rather than dropped.

#### Scenario: Multi-segment reply is paced
- **WHEN** Gateway delivers several segments
- **THEN** it MUST wait a bounded delay before each segment
- **AND** the segments MUST NOT arrive simultaneously

#### Scenario: Longer segment waits longer
- **WHEN** two segments differ in visible character count
- **THEN** the longer segment's computed delay MUST NOT be smaller than the shorter
  segment's, given the same configuration

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
