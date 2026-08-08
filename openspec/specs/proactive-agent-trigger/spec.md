# proactive-agent-trigger Specification

## Purpose
Define trusted `EventRecord` submission through the public Messenger facade and its runtime scheduling semantics.

## Requirements

### Requirement: Trusted Event Submission Facade
Core MUST expose `ctx.yesimbot.messenger.post(event: EventRecord, options?)`. The operation MUST accept a complete EventRecord, MUST NOT accept a synthetic MessageRecord, and MUST resolve after the producing runtime has accepted the operation and any active output delivery has completed.

#### Scenario: Trusted plugin posts an event
- **WHEN** a trusted plugin calls `ctx.yesimbot.messenger.post()` with a declaration-merged EventRecord
- **THEN** Core MUST target the record's `platform`, `selfId`, and `channel.id`
- **AND** Core MUST retain the event type, text, and declared variant fields
- **AND** Core MUST NOT require or retain a Session

#### Scenario: Matching Bot is unavailable
- **WHEN** no current Bot exactly matches the EventRecord's `platform` and `selfId`
- **THEN** `post()` MUST reject
- **AND** Core MUST NOT commit the EventRecord or start a turn

### Requirement: Post Defaults and Will Bypass
`messenger.post()` MUST default to `{ trigger: true, ifBusy: "defer" }`. A trusted post MUST bypass both `WillEngine.decide()` and `WillEngine.observe()` while retaining the normal AgentPlugin, prompt, tool, model, FIFO, and output lifecycle.

#### Scenario: Default post reaches an idle runtime
- **WHEN** a trusted post targets an idle channel runtime
- **THEN** Core MUST append and publish the EventRecord before starting one Agent turn
- **AND** Core MUST expose one internal output iterable to Messenger

#### Scenario: Post joins busy work
- **WHEN** a trusted post uses `ifBusy: "join"` while the runtime has an active turn
- **THEN** Core MUST join the EventRecord to that turn
- **AND** Core MUST NOT create a second output consumer or output iterable

### Requirement: Post Busy Policies
For `trigger: true`, `ifBusy: "defer"` MUST queue an independent turn, `ifBusy: "join"` MUST join active work, and `ifBusy: "reject"` MUST check busy before append. A rejected busy post MUST throw `AgentBusyError` without persisting or emitting the event. `ifBusy` MUST be ignored when `trigger: false`.

#### Scenario: Busy post is rejected
- **WHEN** a trusted post uses `ifBusy: "reject"` while the runtime is busy
- **THEN** Core MUST reject with `AgentBusyError`
- **AND** Core MUST NOT append, persist, or emit that EventRecord

#### Scenario: Deferred posts retain order
- **WHEN** multiple trusted posts use the default defer policy
- **THEN** each MUST enter the channel FIFO as an independent turn
- **AND** Messenger MUST consume and deliver their outputs in channel order

### Requirement: Record-Only Post
`messenger.post(event, { trigger: false })` MUST append the EventRecord through the normal Agent pipeline, persist it, and emit `yesimbot/event`, then resolve without calling Will, starting or joining a turn, or delivering platform output. The event MUST be visible only to later turns.

#### Scenario: Record-only post during active work
- **WHEN** `trigger: false` is posted while another turn is active
- **THEN** Core MUST commit the event through the runtime FIFO
- **AND** it MUST NOT add the event to the active model input or queue a new turn

### Requirement: Producing-Runtime Delivery Failure
When passive or active platform delivery rejects, Messenger MUST call `fail()` on the producing ChannelRuntime. The runtime MUST append exactly one same-channel `delivery.failed` EventRecord and MUST NOT route that feedback through `messenger.post()` or external admission. Later inputs and later independent outputs MUST continue.

#### Scenario: Active delivery fails
- **WHEN** `Bot.sendMessage()` rejects for a segment of a posted reply
- **THEN** Core MUST append one `delivery.failed` EventRecord through the producing runtime
- **AND** Core MUST stop later segments of that reply without retrying
