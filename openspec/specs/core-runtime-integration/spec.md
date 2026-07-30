# core-runtime-integration Specification

## Purpose

Define how `koishi-plugin-yesimbot` integrates Koishi with `@yesimbot/agent-runtime`, including the runtime manager, channel runtime lifecycle, WillEngine evaluation, JSONL storage, prompt injection, reset, stop ordering, and error isolation.

## Requirements

### Requirement: Core Runtime Facade
`YesImBotService` MUST remain a thin Koishi composition facade in top-level `service.ts`. It MUST expose SessionResolver and Agent plugin registration, `getStoragePath(scope)`, and channel reset, and MUST delegate Session handling and runtime lifecycle to internal modules. It MUST NOT expose runtime reload, Will, or WillEngine factory registration.

#### Scenario: Platform plugin registers a resolver
- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

### Requirement: Runtime Manager Ownership
RuntimeManager MUST own channel Runtime creation, replacement, reset, and global stop. It MUST share concurrent first creation for one persistent channel tuple. It MUST NOT accept Session, call SessionResolver, send platform messages, or serve as an event broadcast bus.

#### Scenario: First event reaches a channel
- **WHEN** RuntimeManager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the channel tuple

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** RuntimeManager MUST create one ChannelRuntime and route every event to it

### Requirement: Single Channel Runtime Ownership
Each ChannelRuntime MUST represent exactly one persistent channel tuple and MUST own that channel's FIFO, Agent, JSONL storage, WillEngine instance, local state, model projection, and Agent-internal stream consumption. It MUST hold an immutable ChannelScope. Shared scopes with different `selfId` values MUST use the same tuple but MUST NOT own concurrent Runtime instances. Direct scopes with different `selfId` values MUST use different tuples.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable ChannelScope and bound execution resources

#### Scenario: Shared assignee differs from cached runtime
- **WHEN** RuntimeManager routes an admitted shared event whose `selfId` differs from the cached Runtime's `selfId`
- **THEN** it MUST stop the cached Runtime, replace it with one bound to the admitted `selfId`, and handle the event through that replacement

### Requirement: FIFO Input Lifecycle
ChannelRuntime MUST serialize accepted `MessageRecord | EventRecord` values through one channel FIFO for Input creation, persistence, committed-input observation, and WillEngine decision. It MUST persist Input before calling WillEngine.

#### Scenario: Accepted event enters a channel
- **WHEN** RuntimeManager routes a resolved input record to ChannelRuntime
- **THEN** ChannelRuntime MUST append its Message or Event
- **AND** it MUST emit `yesimbot/event`
- **AND** it MUST then evaluate WillEngine and emit `yesimbot/will`

### Requirement: Message-Level Outbound Ownership
When WillEngine triggers an idle Agent, ChannelRuntime MUST own the sole consumer of the Agent internal stream and MUST expose only complete renderable assistant messages as `AsyncIterable<ChannelRuntime.Output>`. Each run result MUST include that iterable and a delivery interface containing an abort signal, first-success notification, and same-runtime failure feedback. Each output MUST carry ordered element segments parsed exactly once from that assistant message. ChannelRuntime MUST NOT re-parse an assistant message it has already parsed, and MUST NOT expose token deltas, tool events, or raw Agent internal events to Gateway.

#### Scenario: Assistant message is appended
- **WHEN** the Agent appends a complete assistant message with renderable content
- **THEN** ChannelRuntime MUST yield one ChannelRuntime.Output without waiting for turn completion
- **AND** that message MUST be parsed exactly once

#### Scenario: Turn emits internal events
- **WHEN** the Agent emits tool, plugin, delta, or lifecycle events
- **THEN** ChannelRuntime MUST consume them internally and MUST NOT yield them to Gateway

### Requirement: Busy Turn Join Ownership
When WillEngine triggers while the channel Agent is busy, ChannelRuntime MUST join the committed Input to the active turn and MUST NOT create another Agent internal stream consumer or output iterable.

#### Scenario: Busy channel receives a trigger
- **WHEN** WillEngine returns `trigger` and an active turn exists
- **THEN** ChannelRuntime MUST join the record to that turn
- **AND** the Gateway for the joined event MUST receive no outbound iterable

### Requirement: Default Will Routing Configuration
Core Will configuration MUST be a discriminated union selecting `routing` or `willingness`, defaulting to `routing`. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`; its defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Willingness configuration MUST expose `probabilityThreshold`, `decayHalfLifeSeconds`, and `replyCost`. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no engine or routing override is configured
- **THEN** the routing WillEngine MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

#### Scenario: Willingness engine is selected
- **WHEN** configuration explicitly selects `willingness`
- **THEN** future ChannelRuntimes MUST use willingness with the configured controls

### Requirement: Channel Runtime Reset
RuntimeManager MUST stop and remove a cached ChannelRuntime if present, then clear `sessions/messages.jsonl` and scoped assets. Reset MUST NOT revalidate shared-channel assignment. The cleanup path MUST apply to cached and uncached channels. JSONL and asset cleanup MUST be independently attempted in that order; a cleanup error MUST be reported only after later mandatory cleanup and cache deletion complete. Reset MUST preserve the Manifest and every plugin-created child.

#### Scenario: Cached channel is reset
- **WHEN** reset targets an active channel
- **THEN** RuntimeManager MUST stop it before using the shared sessions-and-assets cleanup path
- **AND** it MUST remove the cached runtime after cleanup is attempted

#### Scenario: Uncached channel is reset
- **WHEN** reset targets a channel without a cached runtime
- **THEN** RuntimeManager MUST use the same sessions-and-assets cleanup path
- **AND** it MUST preserve the Manifest, workspace, and every other plugin-created child

### Requirement: Runtime Stop Ordering
Global stop MUST stop Gateway admission, stop RuntimeManager admission, interrupt and stop all ChannelRuntime Agent and WillEngine instances, terminate output iterables, wait active Gateway handlers, and release in-memory runtimes. Global stop MUST preserve JSONL history and assets.

#### Scenario: Core is disposed during an active turn
- **WHEN** global stop begins while a channel turn is active
- **THEN** core MUST prevent new admission and terminate the active runtime work
- **AND** it MUST wait for the owning Gateway handler to finish

### Requirement: Runtime Error Isolation
Core MUST isolate failures so one channel's error cannot stop another channel. Core MUST NOT re-check host fields on records it constructed at Session ingress, and JSONL read-back MUST recover independently from a line with invalid JSON syntax.

#### Scenario: Record is routed internally
- **WHEN** Gateway passes an assembled record to RuntimeManager
- **THEN** Core MUST NOT re-check that record's host fields against the scope they were derived from

#### Scenario: Persisted history is read from disk
- **WHEN** Core reads a stored input from JSONL
- **THEN** it MUST skip a line whose JSON syntax cannot be parsed and report a warning
- **AND** it MUST return every successfully parsed line without Core semantic schema validation

#### Scenario: One channel runtime throws
- **WHEN** a channel runtime raises during input handling
- **THEN** other channel runtimes MUST continue operating

### Requirement: Channel JSONL Storage
Core MUST use one append-only JSONL storage file per persistent channel tuple at `getStoragePath(scope)/sessions/messages.jsonl`.

#### Scenario: Storage path construction
- **WHEN** Core creates storage for a ChannelRuntime
- **THEN** it MUST obtain the `sessions/messages.jsonl` path through the Core channel storage protocol
- **AND** it MUST NOT derive, sanitize, hash, or append raw platform coordinates locally

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, compression, or legacy conversion

#### Scenario: Restart reads history
- **WHEN** Core recreates a ChannelRuntime whose current Manifest-backed JSONL file already exists
- **THEN** the Runtime storage MUST read current-format previously appended entries and MUST not read legacy JSONL

### Requirement: Immutable Runtime Image Budget Snapshot
RuntimeManager MUST resolve explicit model image capability and `ImageBudget | null` when creating a ChannelRuntime. ChannelRuntime MUST reuse that snapshot for its lifetime; changed model metadata or `imageInput` configuration MUST activate only when the Runtime is replaced.

#### Scenario: Existing runtime handles another model call
- **WHEN** model metadata or imageInput configuration changes after ChannelRuntime initialization
- **THEN** the active Runtime MUST retain its existing `ImageBudget | null` snapshot
