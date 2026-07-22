## ADDED Requirements

### Requirement: Core Runtime Facade
`YesImBotService` MUST remain a thin Koishi composition facade in top-level `service.ts`. It MUST expose SessionResolver, `Will.Factory`, and Agent plugin registration plus channel reset, and MUST delegate Session handling and runtime lifecycle to internal modules.

#### Scenario: Platform plugin registers a resolver
- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

#### Scenario: Plugin registers a Will factory
- **WHEN** a plugin calls `ctx.yesimbot.registerWill()`
- **THEN** the facade MUST delegate the active factory to RuntimeManager

### Requirement: Runtime Manager Ownership
RuntimeManager MUST own the map from canonical ChannelScope to ChannelRuntime, concurrent get-or-create behavior, channel reset, `Will.Factory` replacement, and global stop. It MUST NOT accept Session, call SessionResolver, send platform messages, or serve as an event broadcast bus.

#### Scenario: First event reaches a channel
- **WHEN** RuntimeManager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the canonical channel key

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** RuntimeManager MUST create one ChannelRuntime and route every event to it

### Requirement: Single Channel Runtime Ownership
Each ChannelRuntime MUST represent exactly one channel and MUST own that channel's FIFO, Agent, JSONL storage, Will instance, local state, model projection, and Agent-internal stream consumption.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable channel identity

### Requirement: FIFO Event Lifecycle
ChannelRuntime MUST serialize accepted EventRecords through one channel FIFO for Event creation, persistence, committed-event observation, and Will decision. It MUST persist Event before calling Will.

#### Scenario: Accepted event enters a channel
- **WHEN** RuntimeManager routes a resolved event to ChannelRuntime
- **THEN** ChannelRuntime MUST append its Event
- **AND** it MUST emit `yesimbot/event`
- **AND** it MUST then evaluate Will and emit `yesimbot/will`

### Requirement: Message-Level Outbound Ownership
When Will triggers an idle Agent, ChannelRuntime MUST own the sole consumer of the Agent internal stream and MUST expose only complete renderable assistant messages as `AsyncIterable<ChannelRuntime.Output>`. It MUST NOT expose token deltas, tool events, or raw Agent internal events to Gateway.

#### Scenario: Assistant message is appended
- **WHEN** the Agent appends a complete assistant message with renderable content
- **THEN** ChannelRuntime MUST yield one ChannelRuntime.Output without waiting for turn completion

#### Scenario: Turn emits internal events
- **WHEN** the Agent emits tool, plugin, delta, or lifecycle events
- **THEN** ChannelRuntime MUST consume them internally and MUST NOT yield them to Gateway

### Requirement: Busy Turn Join Ownership
When Will triggers while the channel Agent is busy, ChannelRuntime MUST join the committed Event to the active turn and MUST NOT create another Agent internal stream consumer or output iterable.

#### Scenario: Busy channel receives a trigger
- **WHEN** Will returns `trigger` and an active turn exists
- **THEN** ChannelRuntime MUST join the record to that turn
- **AND** the Gateway for the joined event MUST receive no outbound iterable

### Requirement: Default Will Routing Configuration
First-version routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`. Defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no routing override is configured
- **THEN** DefaultWill MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

### Requirement: Channel Runtime Reset
RuntimeManager MUST reset one channel in this order: interrupt Agent, stop Agent, stop Will, wait channel work, clear JSONL, clear scoped assets, and remove the ChannelRuntime. Reset MUST also clear persisted channel data when no runtime is cached.

#### Scenario: Cached channel is reset
- **WHEN** reset targets an active channel
- **THEN** RuntimeManager MUST follow the required teardown and clearing order

#### Scenario: Uncached channel is reset
- **WHEN** reset targets a channel without a cached runtime
- **THEN** RuntimeManager MUST clear that channel's JSONL and scoped assets if present

### Requirement: Runtime Stop Ordering
Global stop MUST stop Gateway admission, stop RuntimeManager admission, interrupt and stop all ChannelRuntime Agent and Will instances, terminate output iterables, wait active Gateway handlers, and release in-memory runtimes. Global stop MUST preserve JSONL history and assets.

#### Scenario: Core is disposed during an active turn
- **WHEN** global stop begins while a channel turn is active
- **THEN** core MUST prevent new admission and terminate the active runtime work
- **AND** it MUST wait for the owning Gateway handler to finish

### Requirement: Runtime Error Isolation
Resolver, persistence, Will, Agent, observation listener, projection, and delivery failures MUST retain their distinct diagnostics and MUST NOT be mislabeled as one another. A failure in one channel MUST NOT stop another channel runtime.

#### Scenario: Will observer throws
- **WHEN** a `yesimbot/will` listener throws
- **THEN** core MUST record a listener diagnostic
- **AND** it MUST preserve and execute the Will decision

## REMOVED Requirements

### Requirement: Core Service API

**Reason**: The public platform and delivery services are removed and the facade gains resolver and Will factory registration.

**Migration**: Use the replacement core runtime facade requirement.

### Requirement: Channel Runtime Ownership

**Reason**: The old ChannelRuntime managed every cached channel and retained Session for delivery.

**Migration**: Use RuntimeManager plus one Session-free ChannelRuntime per channel.

### Requirement: Channel Runtime Identity

**Reason**: Channel identity now belongs to one ChannelRuntime instance created by RuntimeManager.

**Migration**: Derive the canonical key before runtime creation and keep it immutable within the instance.

### Requirement: Core Configuration

**Reason**: Platform profiles and `append | reply` routing are removed.

**Migration**: Keep base path, model, and log settings; express initial routing as DefaultWill `wait | trigger` configuration.

### Requirement: Platform Message Conversion

**Reason**: `Platform.Message` conversion is replaced by EventRecords persisted as `yesimbot.event` custom Events.

**Migration**: Route EventRecord to ChannelRuntime and create Event there.

### Requirement: Platform Event Type Surface

**Reason**: Platform events and messages now share EventMap, EventRecord, and Event.

**Migration**: Use the platform-event-contract replacement requirements.

### Requirement: Message Routing

**Reason**: Permanent `ignore | append | reply` classification is replaced by resolver admission and Will `wait | trigger`.

**Migration**: Implement current behavior in DefaultWill.

### Requirement: Platform Message Model Projection

**Reason**: Model projection now consumes generic Event custom messages.

**Migration**: Use the platform-message-formatting replacement requirements.

### Requirement: Single Synchronous Adapter Refiner

**Reason**: The adapter refiner is replaced by one asynchronous per-platform SessionResolver.

**Migration**: Register a SessionResolver through `ctx.yesimbot.registerResolver()`.

### Requirement: Core Receipt-Time Authority

**Reason**: Runtime events use the normalized Satori event timestamp and no longer store a separate core `receivedAt` message field.

**Migration**: Ensure Session resolution supplies a valid runtime event timestamp.

### Requirement: Static Message-ID Tool Capability

**Reason**: The behavior moves to EventRecord projection terminology.

**Migration**: Active channel plugins MUST keep declaring `requiresMessageId`; core formatting reads it when projecting message Events.

### Requirement: Canonical Platform Service Entry

**Reason**: `PlatformService` and `ctx.yesimbot.platform` are removed.

**Migration**: Register SessionResolver through `ctx.yesimbot.registerResolver()` and observe committed Events through Koishi events.

### Requirement: FIFO Channel Message Lifecycle

**Reason**: The FIFO now handles all accepted channel events and includes persistence and Will ordering.

**Migration**: Use the replacement FIFO event lifecycle requirement.

### Requirement: Reset Is Ordered With Preparation

**Reason**: Resource freezing completes in Gateway before routing, and reset now targets the per-channel runtime and shared AssetStore.

**Migration**: Use the replacement channel runtime reset requirement.

### Requirement: Assistant Reply Rendering

**Reason**: Complete assistant messages are yielded during the turn rather than rendered as one post-turn batch.

**Migration**: Use the message-level outbound ownership and message-delivery requirements.

### Requirement: Channel Reset

**Reason**: Reset must also stop the per-channel Will and clear the shared scoped AssetStore.

**Migration**: Use the replacement channel runtime reset requirement.

### Requirement: Error Handling

**Reason**: The new pipeline separates resolver, Will, Agent, observer, and delivery error domains.

**Migration**: Use the replacement runtime error isolation and message-delivery requirements.

### Requirement: Runtime Disposal

**Reason**: Global disposal now spans Gateway, RuntimeManager, per-channel Will, output iterables, and active Gateway handlers.

**Migration**: Use the replacement runtime stop ordering requirement.
