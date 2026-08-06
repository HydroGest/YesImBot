# core-runtime-integration Specification

## Purpose

Define how `koishi-plugin-yesimbot` integrates Koishi with `@yesimbot/agent-runtime`, including the runtime manager, channel runtime lifecycle, WillEngine evaluation, JSONL storage, prompt injection, reset, stop ordering, and error isolation.

## Requirements

### Requirement: Core Runtime Facade
`YesImBotService` MUST expose model access, scoped assets, SessionResolver registration, Agent plugin registration, Will config contributor and Will engine factory registration, `getStoragePath(scope)`, channel reset, global stop, and `trigger(event: EventRecord)`. It MUST delegate Session handling and channel runtime lifecycle to internal modules. It MUST own the Bot transport used by `trigger()` and MUST NOT expose RuntimeManager, ChannelRuntime, an output iterable, runtime reload, WillEngine instances, or runtime internals.

#### Scenario: Platform plugin registers a resolver
- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

#### Scenario: Trusted caller triggers an event
- **WHEN** Core or a trusted plugin calls `ctx.yesimbot.trigger()` with a complete EventRecord
- **THEN** the facade MUST arrange forced handling through the target ChannelRuntime
- **AND** it MUST complete the operation without exposing runtime internals to the caller


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

### Requirement: Optional Will Policy Extensions
Core MUST allow optional plugins to register Will config contributors and Will engine factories through `ctx.yesimbot`. Contributors MUST receive the immutable `ChannelScope` and current `WillConfig` and may return a patch. Factories MUST receive the scope, the config after contributor patches, and a `createDefault()` factory; they may return a WillEngine or undefined. RuntimeManager MUST apply contributor patches in priority order and use the first factory that returns an engine; when no factory returns an engine, it MUST create the built-in engine from the final config. Without any extension, Core MUST preserve the default routing or willingness behavior.

#### Scenario: No Will extension is registered
- **WHEN** a ChannelRuntime is created with no Will contributors or factories
- **THEN** Core MUST use the built-in routing or willingness engine from the base configuration

#### Scenario: Config contributor patches a routing decision
- **WHEN** a plugin contributor returns a routing patch for a matching scope
- **THEN** RuntimeManager MUST clone and merge the patch before creating the WillEngine

#### Scenario: Engine factory replaces the default engine
- **WHEN** a registered factory returns a WillEngine for a ChannelRuntime
- **THEN** Core MUST use that engine instead of the built-in engine

#### Scenario: Engine factory wraps the default engine
- **WHEN** a registered factory calls `createDefault()` and returns a wrapper
- **THEN** Core MUST use the wrapper while the built-in engine remains available through the factory context

### Requirement: Channel Runtime Reset
RuntimeManager MUST stop and remove a cached ChannelRuntime if present, then clear that channel's persisted JSONL history and scoped assets. Reset MUST NOT revalidate shared-channel assignment. The cleanup path MUST apply to cached and uncached channels. JSONL and asset cleanup MUST be independently attempted in that order; a cleanup error MUST be reported only after later mandatory cleanup and cache deletion complete. Reset MUST preserve the Manifest and every plugin-created child.

#### Scenario: Cached channel is reset
- **WHEN** reset targets an active channel
- **THEN** RuntimeManager MUST stop it before using the shared history-and-assets cleanup path
- **AND** it MUST remove the cached runtime after cleanup is attempted

#### Scenario: Uncached channel is reset
- **WHEN** reset targets a channel without a cached runtime
- **THEN** RuntimeManager MUST use the same history-and-assets cleanup path
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
Core MUST use one append-only JSONL storage stream per persistent channel tuple below its channel root.

#### Scenario: Storage path construction
- **WHEN** Core creates storage for a ChannelRuntime
- **THEN** it MUST obtain the storage location through the Core channel storage protocol
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
