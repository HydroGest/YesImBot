## ADDED Requirements

### Requirement: Online Assignee Handover

RuntimeManager MUST replace a cached shared-channel Runtime when Koishi Database changes the assignee, while preserving the Channel Key and persisted data.

#### Scenario: Cached Runtime belongs to old assignee
- **WHEN** a shared event passes admission for a `selfId` that differs from the cached Runtime Entry
- **THEN** RuntimeManager MUST mark the old generation as draining inside the per-Key lifecycle coordinator
- **AND** it MUST prevent that Runtime from accepting new platform events
- **AND** it MUST release the lifecycle coordinator before awaiting completion

#### Scenario: Old generation drains
- **WHEN** a Runtime generation is draining
- **THEN** Core MUST wait for Agent idle, model stream completion, Gateway delivery leases, and that generation's internal delivery-failure completion lane
- **AND** graceful stop MUST NOT interrupt a normally progressing turn

#### Scenario: New assignee Runtime is created
- **WHEN** the old generation has drained and stopped
- **THEN** RuntimeManager MUST re-enter the lifecycle coordinator and verify the generation
- **AND** it MUST query the latest database assignee again
- **AND** it MUST create a Runtime with the new Bot, Scope, Will, and plugins only if the waiting event still matches the assignee
- **AND** it MUST reuse the same Channel JSONL, Asset, and Workspace roots

### Requirement: Handover Backpressure

RuntimeManager MUST bound events waiting for one shared-channel handover and MUST fail closed when handover cannot complete.

#### Scenario: Handover queue reaches its limit
- **WHEN** five events are already waiting for one Channel Key handover
- **THEN** Core MUST reject additional events explicitly
- **AND** it MUST NOT create another Runtime or retain an unbounded queue

#### Scenario: Assignee changes again during handover
- **WHEN** a waiting event reaches submission after the assignee changes again
- **THEN** Core MUST reject that stale event

#### Scenario: Drain is stuck or fails
- **WHEN** graceful drain does not complete or reports an error
- **THEN** RuntimeManager MUST remain fail closed
- **AND** it MUST NOT start a replacement Runtime until explicit stop or restart recovery

## MODIFIED Requirements

### Requirement: Single Channel Runtime Ownership

Each ChannelRuntime MUST represent exactly one Core Channel Key and MUST own that channel's FIFO, Agent, JSONL storage, Will instance, local state, model projection, and Agent-internal stream consumption. Shared scopes with different `selfId` values MUST use the same Channel Key but MUST NOT own concurrent Runtime instances. Direct scopes with different `selfId` values MUST use different Channel Keys.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable Channel Key and bound execution Scope

#### Scenario: Shared assignee changes
- **WHEN** RuntimeManager admits a different `selfId` for an existing shared Channel Key
- **THEN** it MUST perform online assignee handover instead of creating a concurrent Runtime

### Requirement: Channel JSONL Storage

Core MUST use one append-only JSONL storage file per Channel Key at `<basePath>/channels/<key>/sessions/messages.jsonl`.

#### Scenario: Storage path construction
- **WHEN** Core creates storage for a ChannelRuntime
- **THEN** it MUST obtain the `sessions/messages.jsonl` path through the Core channel storage protocol
- **AND** it MUST NOT derive, sanitize, hash, or append raw platform coordinates locally

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, compression, or legacy conversion

#### Scenario: Restart reads history
- **WHEN** Core recreates a ChannelRuntime whose canonical JSONL file already exists
- **THEN** the Runtime storage MUST read the previously appended entries

#### Scenario: Shared assignee restarts Runtime
- **WHEN** Koishi changes a shared Channel's assignee and RuntimeManager rebuilds the Runtime
- **THEN** the new Runtime MUST read the same JSONL history
