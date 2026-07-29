# core-runtime-integration Specification

## Purpose

Define how `koishi-plugin-yesimbot` integrates Koishi with `@yesimbot/agent-runtime`, including the runtime manager, channel runtime lifecycle, WillEngine evaluation, JSONL storage, prompt injection, reset, stop ordering, and error isolation.

## Requirements

### Requirement: Core Runtime Facade
`YesImBotService` MUST remain a thin Koishi composition facade in top-level `service.ts`. It MUST expose SessionResolver and Agent plugin registration plus channel reset and reload, and MUST delegate Session handling and runtime lifecycle to internal modules. It MUST NOT expose Will or WillEngine factory registration.

#### Scenario: Platform plugin registers a resolver
- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

### Requirement: Runtime Manager Ownership
RuntimeManager MUST own the map from `channelIdentity` to ChannelRuntime, concurrent get-or-create behavior, per-identity lifecycle serialization, explicit reload, channel reset, and global stop. It MUST NOT accept Session, call SessionResolver, send platform messages, or serve as an event broadcast bus.

#### Scenario: First event reaches a channel
- **WHEN** RuntimeManager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the channel identity

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** RuntimeManager MUST create one ChannelRuntime and route every event to it

### Requirement: Single Channel Runtime Ownership
Each ChannelRuntime MUST represent exactly one Core `channelIdentity` and MUST own that channel's FIFO, Agent, JSONL storage, WillEngine instance, local state, model projection, and Agent-internal stream consumption. Shared scopes with different `selfId` values MUST use the same identity but MUST NOT own concurrent Runtime instances. Direct scopes with different `selfId` values MUST use different identities.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable identity and bound execution Scope

#### Scenario: Shared assignee differs from cached runtime
- **WHEN** RuntimeManager routes an admitted shared event whose `selfId` differs from the cached Runtime's `selfId`
- **THEN** it MUST fail before persistence with a dedicated reload-required error
- **AND** it MUST NOT drain, retry, replace, or create a Runtime from that route

### Requirement: FIFO Input Lifecycle
ChannelRuntime MUST serialize accepted `MessageRecord | EventRecord` values through one channel FIFO for Input creation, persistence, committed-input observation, and WillEngine decision. It MUST persist Input before calling WillEngine.

#### Scenario: Accepted event enters a channel
- **WHEN** RuntimeManager routes a resolved input record to ChannelRuntime
- **THEN** ChannelRuntime MUST append its Message or Event
- **AND** it MUST emit `yesimbot/event`
- **AND** it MUST then evaluate WillEngine and emit `yesimbot/will`

### Requirement: Message-Level Outbound Ownership
When WillEngine triggers an idle Agent, ChannelRuntime MUST own the sole consumer of the Agent internal stream and MUST expose only complete renderable assistant messages as `AsyncIterable<ChannelRuntime.Output>`. Each output MUST carry ordered element segments parsed exactly once from that assistant message. ChannelRuntime MUST NOT re-parse an assistant message it has already parsed, and MUST NOT expose token deltas, tool events, or raw Agent internal events to Gateway.

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
Core WillEngine configuration MUST select `routing` or `willingness`, defaulting to `routing`. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`; its defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Willingness configuration MUST use static values snapshotted by the ChannelRuntime. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no engine or routing override is configured
- **THEN** the routing WillEngine MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

#### Scenario: Willingness engine is selected
- **WHEN** configuration explicitly selects `willingness`
- **THEN** RuntimeManager MUST construct the temporary static willingness WillEngine for future ChannelRuntimes

### Requirement: Channel Runtime Reset
RuntimeManager MUST validate current assignment, drain and stop a cached ChannelRuntime if present, revalidate assignment before destructive cleanup, clear `sessions/messages.jsonl` and scoped assets through one RuntimeManager-owned cleanup path, and remove the cache entry. The cleanup path MUST apply to cached and uncached channels. JSONL and asset cleanup MUST be independently attempted in that order; a cleanup error MUST be reported only after later mandatory cleanup and cache deletion complete. Reset MUST preserve the Manifest, workspace, and every other registered storage namespace.

#### Scenario: Cached channel is reset
- **WHEN** reset targets an active channel
- **THEN** RuntimeManager MUST drain and stop it before revalidating assignment and using the shared sessions-and-assets cleanup path
- **AND** it MUST remove the cached runtime after cleanup is attempted

#### Scenario: Uncached channel is reset
- **WHEN** reset targets a channel without a cached runtime
- **THEN** RuntimeManager MUST validate assignment and use the same sessions-and-assets cleanup path
- **AND** it MUST preserve the Manifest, workspace, and every other registered storage namespace

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
Core MUST use one append-only JSONL storage file per channel identity at the path returned by Manifest-backed channel storage: `<basePath>/channels/<directoryName>/sessions/messages.jsonl`.

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

#### Scenario: Shared assignee reload recreates Runtime
- **WHEN** an operator explicitly reloads a shared channel after Koishi changes its assignee
- **THEN** the next admitted event MUST lazily create a Runtime for the current assignee
- **AND** that Runtime MUST read the same JSONL history

### Requirement: Non-Destructive Runtime Refresh
`YesImBotService` MUST expose `reload(scope): Promise<void>` as the explicit trusted path to refresh one ChannelRuntime after a stable prompt, persona, plugin-instruction, tool, model, provider, or shared-assignee change. Reload MUST validate current assignment, coalesce concurrent reloads for one identity, mark a cached Runtime as reloading in the per-identity lifecycle queue, drain and stop it outside that queue, and remove its cache entry. Reload MUST NOT clear channel history, assets, workspace, Manifest, or registered storage namespaces, and it MUST NOT construct a replacement. The next accepted event MUST build the fresh runtime snapshot lazily.

#### Scenario: Trusted source requests refresh
- **WHEN** an operator-managed path or optional persona-management plugin activates new trusted persona content
- **THEN** Core MUST validate current assignment
- **AND** it MUST drain and stop the cached Runtime before removing its cache entry
- **AND** the next accepted event MUST lazily create a Runtime that reads the existing channel JSONL history

#### Scenario: Assignee change requires refresh
- **WHEN** an admitted shared event has a `selfId` that differs from its cached Runtime
- **THEN** Core MUST return a dedicated reload-required error before persistence
- **AND** an operator MUST invoke `reload(scope)` before Core can create a Runtime for the new assignee

#### Scenario: Refresh fails while draining
- **WHEN** the cached ChannelRuntime cannot drain or stop cleanly
- **THEN** Core MUST remain fail closed for that channel identity
- **AND** it MUST NOT publish a concurrent replacement runtime
- **AND** it MUST preserve persisted channel data

#### Scenario: Refresh differs from reset
- **WHEN** a caller requests a stable prompt refresh
- **THEN** Core MUST NOT invoke channel reset semantics
- **AND** it MUST NOT clear sessions or assets

#### Scenario: Refresh targets an uncached channel
- **WHEN** a trusted caller requests refresh for a channel with no cached runtime
- **THEN** Core MUST validate current assignment and return without creating a runtime
- **AND** the next accepted event MUST create the runtime from the latest stable sources

#### Scenario: Input routes during reload
- **WHEN** an admitted InputRecord routes for an identity whose cached Runtime is reloading
- **THEN** RuntimeManager MUST reject it with a dedicated reload-in-progress error before persistence
- **AND** it MUST NOT wait or retry that InputRecord

#### Scenario: Concurrent reload calls coalesce
- **WHEN** multiple callers request reload for the same channel identity
- **THEN** they MUST await the same reload operation
- **AND** Core MUST NOT create an additional runtime solely for each concurrent call

### Requirement: Immutable Runtime Media Snapshot
RuntimeManager MUST snapshot the resolved image-input capability and configured model-call media policy when creating a ChannelRuntime. ChannelRuntime MUST reuse that snapshot for its lifetime, and a changed capability or policy MUST activate only through explicit non-destructive reload.

#### Scenario: Existing runtime handles another model call
- **WHEN** model metadata or multimedia configuration changes after ChannelRuntime initialization
- **THEN** the active runtime MUST retain its existing media capability and policy snapshot

#### Scenario: Runtime is reloaded
- **WHEN** a trusted caller reloads the channel after a media policy change
- **THEN** the next lazily created runtime MUST use the latest resolved capability and policy without clearing history or assets

### Requirement: Single Serialization Primitive
Core MUST serialize per-identity lifecycle operations, per-channel input handling, and delivery bookkeeping through one shared serialization primitive. Core MUST NOT maintain separate duplicated promise-chain schedulers for these concerns.

#### Scenario: Concurrent operations on one channel
- **WHEN** two operations targeting the same channel are submitted concurrently
- **THEN** they MUST execute in submission order
- **AND** a rejected operation MUST NOT prevent the next operation from running

### Requirement: Runtime Module Seams
Core MUST separate cross-channel lifecycle orchestration, per-channel session ownership, and delivery transport into distinct modules with explicit interfaces. Core MUST NOT require a test-only construction seam to substitute a channel runtime.

#### Scenario: Channel runtime is constructed in a test
- **WHEN** a test constructs a channel runtime
- **THEN** it MUST be constructible through its real interface
- **AND** no injection option MUST exist solely to replace it
