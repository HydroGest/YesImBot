## MODIFIED Requirements

### Requirement: Message-Level Outbound Ownership
When WillEngine triggers an idle Agent, ChannelRuntime MUST own the sole consumer of
the Agent internal stream and MUST expose only complete renderable assistant messages
as `AsyncIterable<ChannelRuntime.Output>`. Each output MUST carry ordered element
segments parsed exactly once from that assistant message. ChannelRuntime MUST NOT
re-parse an assistant message it has already parsed, and MUST NOT expose token deltas,
tool events, or raw Agent internal events to Gateway.

#### Scenario: Assistant message is appended
- **WHEN** the Agent appends a complete assistant message with renderable content
- **THEN** ChannelRuntime MUST yield one ChannelRuntime.Output without waiting for turn completion
- **AND** that message MUST be parsed exactly once

#### Scenario: Turn emits internal events
- **WHEN** the Agent emits tool, plugin, delta, or lifecycle events
- **THEN** ChannelRuntime MUST consume them internally and MUST NOT yield them to Gateway

### Requirement: Runtime Error Isolation
Core MUST isolate failures so one channel's error cannot stop another channel, and MUST
validate untrusted data only at its two real trust boundaries: Session ingress and JSONL
read-back. Core MUST NOT re-validate values it constructed itself in the same process,
and MUST NOT traverse a persisted record to assert an architectural invariant at runtime.

#### Scenario: Record is routed internally
- **WHEN** Gateway passes an assembled record to RuntimeManager
- **THEN** Core MUST NOT re-check that record's host fields against the scope they were
  derived from

#### Scenario: Persisted history is read from disk
- **WHEN** Core reads a stored input from JSONL
- **THEN** it MUST validate the parsed value once before use
- **AND** an invalid stored record MUST fail loudly rather than be silently reinterpreted

#### Scenario: One channel runtime throws
- **WHEN** a channel runtime raises during input handling
- **THEN** other channel runtimes MUST continue operating

## ADDED Requirements

### Requirement: Single Serialization Primitive
Core MUST serialize per-identity lifecycle operations, per-channel input handling, and
delivery bookkeeping through one shared serialization primitive. Core MUST NOT maintain
separate duplicated promise-chain schedulers for these concerns.

#### Scenario: Concurrent operations on one channel
- **WHEN** two operations targeting the same channel are submitted concurrently
- **THEN** they MUST execute in submission order
- **AND** a rejected operation MUST NOT prevent the next operation from running

### Requirement: Runtime Module Seams
Core MUST separate cross-channel lifecycle orchestration, per-channel session ownership,
and delivery transport into distinct modules with explicit interfaces. Core MUST NOT
require a test-only construction seam to substitute a channel runtime.

#### Scenario: Channel runtime is constructed in a test
- **WHEN** a test constructs a channel runtime
- **THEN** it MUST be constructible through its real interface
- **AND** no injection option MUST exist solely to replace it
