# schedule Specification

## Purpose
TBD: Channel-scoped scheduled events and their lifecycle.

## Requirements

### Requirement: Channel-Scoped Schedule Records
The Schedule plugin MUST persist each Schedule against exactly one existing ChannelScope using raw `type`, `platform`, `selfId`, and `channelId` coordinates. A Schedule MUST expose an id, title, prompt, once-or-cron rule, state, next execution time, and latest result. The plugin MUST NOT create a separate public channel identity, target scope abstraction, or cross-channel management operation.

#### Scenario: Agent creates a schedule in its current channel
- **WHEN** an Agent invokes the Schedule creation tool in a ChannelRuntime
- **THEN** the plugin MUST persist the Schedule with that runtime's existing ChannelScope
- **AND** the tool MUST NOT accept a target channel or target scope argument
- **AND** the Schedule MUST be visible only when that same ChannelScope is listed

#### Scenario: Administrator manages the current channel
- **WHEN** an authority-4 user invokes a Schedule command in a channel
- **THEN** the command MUST derive the Schedule scope from that command's current Session
- **AND** the plugin MUST NOT retain the Session after the command operation completes
- **AND** the command MUST NOT offer a cross-channel target option

### Requirement: Canonical Schedule Time Rules
A once Schedule MUST use one RFC 3339 execution instant. A recurring Schedule MUST use one five-field cron expression interpreted in fixed `Asia/Shanghai` time. A Schedule MUST NOT persist, configure, or accept a timezone value.

#### Scenario: Agent normalizes a natural-language request
- **WHEN** a user requests a Schedule through natural language
- **THEN** the Agent MUST create it only after canonicalizing the request to either a once instant or a cron expression
- **AND** it MUST request clarification instead of persisting an ambiguous time or recurrence

#### Scenario: Invalid schedule rule is rejected
- **WHEN** creation or update supplies a past once instant, invalid cron expression, both rule forms, or neither rule form
- **THEN** the plugin MUST reject the operation before persisting a Schedule or arming a timer

### Requirement: Schedule Lifecycle Management
The plugin MUST support enabled, paused, cancelled, and completed Schedule states. An enabled Schedule MUST have a next execution time. A paused, cancelled, or completed Schedule MUST have no armed next execution. A once Schedule MUST become completed after its occurrence is accepted, fails, or is missed.

#### Scenario: Pause and resume a recurring Schedule
- **WHEN** a user or Agent pauses an enabled recurring Schedule
- **THEN** the plugin MUST prevent future submission and retain the rule and latest result
- **WHEN** the Schedule is resumed
- **THEN** the plugin MUST calculate only its next future occurrence

#### Scenario: Cancel a Schedule before its occurrence is claimed
- **WHEN** a Schedule is cancelled before its due occurrence is claimed
- **THEN** the plugin MUST prevent that occurrence and every later occurrence from submission
- **AND** the Schedule MUST remain inspectable as cancelled

### Requirement: Session-Free Due Event Submission
At a due occurrence, the plugin MUST construct an EventRecord with `eventType: "schedule.due"` and submit it only through `ctx.yesimbot.messenger.post(event)`. The record MUST contain the stored platform, selfId, channel ID, actual submission time, untrusted schedule text, and structured schedule id, title, rule kind, and scheduled occurrence fields. The plugin MUST NOT construct or retain a Session, synthesize a MessageRecord, call Runtimes directly, consume an Agent output stream, or send through Bot directly.

#### Scenario: Idle target runtime receives a due event
- **WHEN** an enabled Schedule reaches its due occurrence and the target runtime is idle
- **THEN** the plugin MUST submit one `schedule.due` EventRecord through the Messenger post facade
- **AND** the existing Core post path MUST append and observe the EventRecord before it starts the Agent turn

#### Scenario: Busy target runtime receives a due event
- **WHEN** an enabled Schedule reaches its due occurrence while the target ChannelRuntime has an active turn
- **THEN** the plugin MUST submit the EventRecord through the same Messenger post facade
- **AND** the existing ChannelRuntime MUST retain ownership of the only output consumer while the event joins the active turn

### Requirement: At-Most-Once Occurrence Submission
Before calling Messenger post, the plugin MUST durably record the due occurrence as `lastResult.status: "submitting"` and advance the Schedule beyond that occurrence. The plugin MUST submit an occurrence at most once within one Koishi process. A normal post resolution MUST produce `accepted`; a post rejection MUST produce `failed`.

#### Scenario: Duplicate timer wake does not duplicate a post
- **WHEN** the scheduler processes the same due occurrence more than once
- **THEN** only the first successful durable `submitting` transition MUST call `ctx.yesimbot.messenger.post()`
- **AND** every later attempt for that occurrence MUST produce no additional post call

#### Scenario: Process stops after durable claim
- **WHEN** a process restarts with a past latest result in `submitting` state
- **THEN** the plugin MUST record that occurrence as `interrupted`
- **AND** it MUST NOT submit that occurrence again

### Requirement: Recovery Without Catch-Up
The plugin MUST recover persisted enabled Schedules when it starts. It MUST NOT replay past occurrences. A missed once Schedule MUST become completed with a `missed` result. A missed cron Schedule MUST record one `missed` result and advance directly to its first future occurrence.

#### Scenario: Recovery skips a missed once occurrence
- **WHEN** the plugin starts with an enabled once Schedule whose occurrence is in the past
- **THEN** it MUST mark that Schedule completed with `lastResult.status: "missed"`
- **AND** it MUST NOT call `ctx.yesimbot.messenger.post()` for the missed occurrence

#### Scenario: Recovery advances a missed cron occurrence
- **WHEN** the plugin starts with an enabled cron Schedule whose next occurrence is in the past
- **THEN** it MUST record one missed result
- **AND** it MUST persist the first future occurrence without catch-up submission

### Requirement: Bounded Schedule Resource Use
The plugin MUST enforce a maximum of 20 enabled Schedules per channel, a minimum cron interval of 15 minutes, a maximum title length of 120 characters, a maximum prompt length of 2000 characters, and no more than five concurrent Core post calls. The plugin MUST NOT create a delayed submission backlog. When no slot is available, it MUST record the occurrence as missed and advance or complete it according to its rule.

#### Scenario: Limit blocks a new schedule
- **WHEN** a channel already has 20 enabled Schedules
- **THEN** creating another enabled Schedule MUST reject before persistence

#### Scenario: No post slot is available
- **WHEN** a due occurrence arrives while five Core post calls are active
- **THEN** the plugin MUST record the occurrence as missed
- **AND** it MUST advance or complete the Schedule without creating a delayed submission

### Requirement: Existing Runtime And Delivery Lifecycles Remain Authoritative
Schedule MUST preserve existing Core reset and stop semantics. Reset MUST NOT remove Schedule records. Plugin shutdown MUST prevent new due submissions while preserving Schedule records. Schedule MUST NOT introduce retries, direct outbound delivery, output history, delivery history, or a model timeout policy. Existing `delivery.failed` events MUST remain the detailed record of output delivery failure.

#### Scenario: Channel reset preserves schedules
- **WHEN** Core resets a channel that has persisted Schedules
- **THEN** Core session history and assets MAY be cleared under the existing reset contract
- **AND** the Schedule records MUST remain available for their future occurrences

#### Scenario: Delivery fails after a post is accepted
- **WHEN** Core accepts a due event but its outbound delivery later fails
- **THEN** Schedule MUST NOT retry the occurrence or create a delivery-history record
- **AND** Core MUST retain its existing same-channel `delivery.failed` Event behavior
