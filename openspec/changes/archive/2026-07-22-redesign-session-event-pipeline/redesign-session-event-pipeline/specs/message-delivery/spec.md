## ADDED Requirements

### Requirement: Gateway-Owned Passive Delivery
Gateway MUST own passive platform delivery and MUST call the original `Session.send()` for every ChannelRuntime.Output. RuntimeManager and ChannelRuntime MUST NOT receive Session or a Session-bound send capability.

#### Scenario: Channel runtime yields output
- **WHEN** Gateway receives a ChannelRuntime.Output from the runtime result
- **THEN** Gateway MUST call the original Session's `send()` with that output

### Requirement: Prompt Message-Level Delivery
Core MUST attempt each complete ChannelRuntime.Output as soon as ChannelRuntime yields it. It MUST NOT wait for the whole Agent turn and MUST NOT send token deltas.

#### Scenario: Turn yields multiple assistant messages
- **WHEN** a turn appends multiple complete assistant messages
- **THEN** Gateway MUST send each message in yield order
- **AND** it MUST begin each send without waiting for turn completion

### Requirement: Per-Message Send Result
Every passive or active send attempt MUST treat a resolved Koishi string array as success and a rejected promise as failure. A resolved empty message ID array MUST count as success. Core MUST NOT require a shared delivery ID, mode, timing, or receipt type.

#### Scenario: Koishi send resolves with IDs
- **WHEN** `Session.send()` or `Bot.sendMessage()` resolves with a string array
- **THEN** the local send result MUST preserve every returned ID, including an empty array

#### Scenario: Koishi send rejects
- **WHEN** a send promise rejects
- **THEN** the local send result MUST contain a normalized error

### Requirement: Durable Passive Delivery Failure
A failed passive send MUST create a channel-scoped `delivery.failed` EventRecord associated with the turn ID and assistant message ID. Gateway MUST route it through RuntimeManager, and DefaultWill MUST not trigger a new turn for it.

#### Scenario: Passive output fails
- **WHEN** `Session.send()` rejects for a ChannelRuntime.Output
- **THEN** Gateway MUST route one `delivery.failed` event to the same channel
- **AND** its EventRecord MUST contain frozen content explaining the failed delivery

#### Scenario: Failure reinjection also fails
- **WHEN** core cannot route or persist `delivery.failed`
- **THEN** it MUST record a diagnostic
- **AND** it MUST NOT recursively create another delivery failure

### Requirement: Continue After Passive Failure
Gateway MUST continue consuming the output iterable and MUST independently attempt later ChannelRuntime.Output values after one passive send fails.

#### Scenario: First of two outputs fails
- **WHEN** the first outbound send rejects and the turn later yields a second outbound message
- **THEN** Gateway MUST attempt the second send
- **AND** each failed send MUST produce its own failure record

### Requirement: Current-Bot Active Send Tool
Core MUST provide an Agent tool that sends through the current bot to an explicit channel ID using `Bot.sendMessage()`. The tool MUST return `{ ok: true, messageIds }` or `{ ok: false, error }` in the same turn and MUST NOT permit selecting another bot identity.

#### Scenario: Agent sends to another channel
- **WHEN** the model calls the active-send tool with a channel available to the current bot
- **THEN** the tool MUST call that bot's `sendMessage()`
- **AND** it MUST return the structured local result as the tool result

#### Scenario: Active send fails
- **WHEN** the active-send tool receives a rejected send
- **THEN** the tool result MUST expose the failure to the model
- **AND** core MUST NOT append a duplicate `delivery.failed` EventRecord

### Requirement: No Public Delivery Service
Core MUST NOT expose `ctx.yesimbot.delivery`, delivery listeners, platform-specific delivery adapters, or a shared delivery helper. Passive Gateway delivery and the active-send tool MUST handle their small result shapes at their owning call sites.

#### Scenario: Plugin inspects the public facade
- **WHEN** a plugin accesses `ctx.yesimbot`
- **THEN** no public delivery service or delivery subscription method MUST be present

## REMOVED Requirements

### Requirement: Koishi-First Message Delivery

**Reason**: Koishi send methods remain authoritative, but ownership moves from DeliveryService to Gateway and the active-send tool.

**Migration**: Use Gateway-owned passive delivery and the current-bot active send tool.

### Requirement: Ordered Logical Output

**Reason**: Outputs are now delivered one complete assistant message at a time during the active turn.

**Migration**: Use the prompt message-level delivery requirement.

### Requirement: Conservative Delivery Receipt

**Reason**: Send results are local to one attempt rather than a public or shared receipt model.

**Migration**: Use the per-message send result requirement.

### Requirement: Delivery Status Observation

**Reason**: Delivery listeners are removed. Passive failures become durable EventRecords, while active results remain tool results.

**Migration**: Observe `delivery.failed` through `yesimbot/event` or inspect the active tool result.

### Requirement: Koishi Encoder Ownership

**Reason**: Koishi still owns Fragment encoding, but the requirement now belongs to direct Gateway and tool sends rather than DeliveryService.

**Migration**: Pass Koishi Fragment values directly to `Session.send()` or `Bot.sendMessage()` without pre-encoding.
