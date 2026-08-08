# core-runtime-integration Specification

## Purpose
Define the public Core facade and the ownership, lifecycle, and stable snapshots of channel resources, Agents, and Runtimes.

## Requirements

### Requirement: Four-Entry Core Facade
`ctx.yesimbot` MUST expose `model`, `messenger.use/post`, `agent.use/will`, and `resource.get/use`, plus the Koishi service lifecycle `stop()`. The facade MUST NOT expose Channels, Channel, Conversation, ChannelResources owners, Runtimes, ChannelRuntime, runtime maps, reset, reload, or delivery callbacks.

#### Scenario: Plugin registers named behavior
- **WHEN** a plugin calls `ctx.yesimbot.agent.use()` or `ctx.yesimbot.agent.will()` with a named object
- **THEN** Core MUST register it and return a disposer

#### Scenario: Trusted caller posts an event
- **WHEN** Core or a trusted plugin calls `ctx.yesimbot.messenger.post()` with a complete EventRecord
- **THEN** the facade MUST arrange handling through the target ChannelRuntime without exposing runtime internals

### Requirement: Runtimes Own Channel Runtime Lifecycle
The private Runtimes owner MUST own ChannelRuntime creation, replacement, reset, and stop. It MUST share concurrent first creation for one persistent channel tuple, use one runtime for a shared `[platform, channelId]` tuple, and use distinct runtimes for direct `[platform, selfId, channelId]` tuples. It MUST NOT accept or retain Session beyond runtime creation's ephemeral plugin matching.

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** Runtimes MUST create one ChannelRuntime and route every event to it

#### Scenario: Shared Bot changes
- **WHEN** an admitted shared event uses a different current Bot selfId
- **THEN** Runtimes MUST stop and replace the cached runtime before handling that event
- **AND** persisted channel data MUST remain intact

### Requirement: ChannelRuntime Owns FIFO Input Lifecycle
ChannelRuntime MUST serialize accepted MessageRecord and EventRecord values through one FIFO for Agent append, persistence, event observation, and passive Will decision. It MUST persist and emit before calling `WillEngine.decide()` on ordinary input. The runtime MUST own one Agent, one storage writer, one immutable ChannelScope, and no Koishi Session.

#### Scenario: Ordinary input enters a channel
- **WHEN** Messenger routes a resolved record
- **THEN** ChannelRuntime MUST append the record and emit `yesimbot/message` or `yesimbot/event`
- **AND** it MUST then evaluate WillEngine

### Requirement: Data-Only Runtime Results
A runtime run result MUST contain only its kind, event identity, optional turn identity, output iterable, and abort signal. It MUST NOT contain delivery, acknowledgement, rejection, send, warn, or lifecycle callbacks. Messenger owns output consumption and calls the producing runtime's explicit failure method when delivery fails.

#### Scenario: Runtime yields assistant output
- **WHEN** a ChannelRuntime starts an idle turn
- **THEN** it MUST expose one complete renderable output iterable
- **AND** it MUST keep token deltas, tool events, and Agent internals private

### Requirement: Busy Join and Stable Snapshots
A busy runtime MUST join an accepted input without creating another output consumer. On runtime creation Core MUST snapshot model resources, prompt, tools, and initialized Agent plugins; active runtimes MUST retain those snapshots until replacement, reset, or stop creates a new runtime.

#### Scenario: Stable resources change
- **WHEN** model, prompt, tool, or plugin registration changes after runtime initialization
- **THEN** the active runtime MUST retain its existing snapshot
- **AND** a replacement runtime MUST use the new resources

### Requirement: Fixed Core Will
The Core default WillEngine MUST trigger direct messages and messages mentioning the current Bot, and MUST wait for ordinary shared messages and non-message events. A missing Session MUST select this fixed default. Optional WillPlugin instances MUST be selected only while a runtime is created from a live Session, ordered by ascending priority and stable registration order.

#### Scenario: Passive and active paths differ
- **WHEN** ordinary Messenger ingress reaches a runtime
- **THEN** Core MAY evaluate WillEngine
- **WHEN** `messenger.post()` reaches a runtime
- **THEN** Core MUST bypass both WillEngine decision and observation

### Requirement: Runtime Reset and Stop
Reset MUST stop and remove the cached runtime, clear only Core-owned conversation history and assets, and preserve the channel Manifest and plugin-owned children. Global stop MUST close Messenger admission, stop all runtimes, await active delivery handlers, and preserve persistent data.

#### Scenario: Core stops during an active turn
- **WHEN** service stop begins during channel work
- **THEN** Core MUST prevent new admission and terminate active runtime work
- **AND** it MUST await Messenger-owned handlers before completing stop

### Requirement: Runtime Error Isolation
A failure in one channel runtime or one delivery MUST NOT stop unrelated channels. Runtime MUST NOT revalidate host fields on records assembled by Messenger. JSONL read-back MUST skip invalid JSON syntax lines while returning every successfully parsed line without Core semantic validation.
