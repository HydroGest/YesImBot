## ADDED Requirements

### Requirement: One Persistent WorldAgent Per World

WorldEngine MUST assign each configured world one stable GlobalScope and MUST run its WorldAgent through the Core GlobalAgent facade. The WorldAgent MUST own one Agent session and one cognitive timeline independent from every ChannelRuntime. Channel Agents MUST NOT act as copies, proxies, or shards of the WorldAgent.

#### Scenario: Two chat access points belong to one world

- **WHEN** accepted messages arrive through two configured channels
- **THEN** WorldEngine MUST route their phone notifications to the same WorldAgent GlobalScope
- **AND** neither ChannelRuntime Agent MUST acquire the WorldAgent's world session

### Requirement: WorldEngine Owns Domain State

WorldEngine MUST own world and subject definitions, narrative status snapshots, chat access points, phone records, read cursors, world clock, activities, scheduling, and audit records below its private GlobalAgent storage child. Core reset MUST NOT interpret or delete those records.

#### Scenario: Core clears the GlobalAgent

- **WHEN** a trusted caller clears the WorldAgent's GlobalScope
- **THEN** Core MUST clear only the GlobalAgent session and assets
- **AND** WorldEngine domain records MUST remain until WorldEngine explicitly resets them

### Requirement: Accepted Messages Enter The Phone

WorldEngine MUST observe only messages that Core has admitted, resolved, persisted, and published as `yesimbot.message`. It MUST accept phone input only from configured chat access points and MUST store the phone record before submitting a notification. It MUST NOT retain the originating Session or treat Core session JSONL as its phone database.

#### Scenario: Configured channel receives a message

- **WHEN** Core publishes a committed message for a configured chat access point
- **THEN** WorldEngine MUST append the corresponding phone conversation record before changing unread state

#### Scenario: Unconfigured channel receives a message

- **WHEN** Core publishes a committed message for a channel absent from the world's chat access points
- **THEN** WorldEngine MUST NOT add it to the WorldAgent phone
- **AND** it MUST NOT notify that WorldAgent

### Requirement: Minimal Coalesced Phone Notification

When a conversation changes from zero unread records to at least one unread record, WorldEngine MUST submit one `phone.notification` custom message. The notification MUST identify the chat access point, unread count, and notification time. It MUST omit sender identity, message body, and media content. Additional messages received while that conversation remains unread MUST update private unread state without another notification turn.

#### Scenario: First unread message arrives

- **WHEN** a configured conversation has no unread records and receives a new message
- **THEN** WorldEngine MUST store the message and submit one minimal notification

#### Scenario: Conversation already has unread messages

- **WHEN** another message arrives while unread records remain
- **THEN** WorldEngine MUST increase the unread count
- **AND** it MUST NOT submit another notification solely for that message

### Requirement: Tool-Mediated Phone Reading

The WorldAgent MUST use WorldEngine tools to open the phone, select its chat application and conversation, and read message content. Selecting the phone or conversation MUST NOT reveal message bodies or mark records as read. Reading MUST begin at the oldest unread record, return records in chronological bounded pages, and advance the read cursor only through the last record actually returned.

#### Scenario: WorldAgent selects an unread conversation

- **WHEN** the WorldAgent opens and selects a conversation without requesting a message page
- **THEN** its unread records MUST remain unread
- **AND** no message body may enter model context

#### Scenario: WorldAgent reads one page

- **WHEN** a phone tool returns a bounded page beginning at the oldest unread record
- **THEN** WorldEngine MUST mark only the returned records as read
- **AND** it MUST return continuation information when later unread records remain

### Requirement: Phone View Is A Perception Record

WorldEngine MUST store the bounded conversation records needed for phone display, unread state, and subject perception. Core channel records MUST remain the authoritative platform journal. WorldEngine MUST NOT expose an arbitrary Core cross-channel history query or backfill messages from before the chat access point was configured.

#### Scenario: WorldEngine is enabled after channel history exists

- **WHEN** a chat access point is configured after older Core channel records already exist
- **THEN** those older records MUST NOT appear in the WorldAgent phone automatically

### Requirement: Phone-Mediated Outbound Messaging

The WorldAgent MUST send platform messages only through WorldEngine phone tools and a configured chat access point. WorldEngine MUST store platform, current Bot self identity, and channel coordinates rather than retaining Session. It MUST resolve the current matching Bot when the send becomes due, record every returned message ID or failure in the phone conversation, and report completion through a later custom message.

#### Scenario: Delayed send succeeds

- **WHEN** a persisted send activity becomes due and a matching Bot sends the content
- **THEN** WorldEngine MUST store the outgoing phone record and every returned message ID
- **AND** it MUST submit a completion perception to the WorldAgent

#### Scenario: Matching Bot is unavailable

- **WHEN** a send activity becomes due without a current matching Bot
- **THEN** WorldEngine MUST record a failed send result
- **AND** it MUST NOT ask a ChannelRuntime Agent to send on the WorldAgent's behalf

### Requirement: Persisted Delayed Activities

Every delayed WorldAgent action MUST become a WorldEngine activity with a stable ID, issued world time, validated duration, expected completion time, activity kind, and lifecycle status. The WorldAgent MUST propose duration in TU. WorldEngine MUST reject non-finite or disallowed duration values, persist an accepted activity before acknowledging it, and return its activity ID and expected completion time immediately.

#### Scenario: WorldAgent starts an accepted action

- **WHEN** a WorldEngine tool accepts a proposed action and duration
- **THEN** WorldEngine MUST persist the activity before returning its start acknowledgement
- **AND** the current GlobalAgent turn MUST NOT wait for expected completion

#### Scenario: WorldAgent proposes an invalid duration

- **WHEN** duration is non-finite, negative, or outside the activity kind's configured bounds
- **THEN** the tool MUST reject without scheduling an activity

### Requirement: Activity Execution And Completion

WorldEngine MUST distinguish activity decision time from completion time. It MAY adjudicate an uncertain world action before `expectedAt` but MUST withhold its result until completion. It MUST execute an external platform send only at or after `expectedAt`. Completion, failure, and accepted cancellation MUST update the activity record before WorldEngine submits the corresponding custom perception.

#### Scenario: World action is adjudicated early

- **WHEN** WorldArbiter returns a result before the activity expectedAt
- **THEN** WorldEngine MUST retain the result privately until expectedAt
- **AND** the WorldAgent MUST NOT perceive completion early

#### Scenario: Pending send is cancelled

- **WHEN** the WorldAgent cancels a send activity before its external side effect begins
- **THEN** WorldEngine MUST mark it cancelled and MUST NOT call the platform Bot

### Requirement: Affine TU World Clock

Each world MUST persist immutable creation-time real-seconds-per-TU and world-seconds-per-TU values plus an optional standard epoch. WorldEngine MUST compute one continuous world-time coordinate from a persisted real-time anchor. A 1:1 mapping MUST represent real-time synchronization without a separate clock mode. Plugin stop, Core stop, and process downtime MUST NOT pause world time.

#### Scenario: WorldEngine restarts after downtime

- **WHEN** WorldEngine loads an existing clock after process downtime
- **THEN** its current TU MUST include the elapsed real interval under the persisted mapping
- **AND** pending expectedAt values MUST retain their original meaning

#### Scenario: Runtime configuration changes the scale

- **WHEN** current configuration differs from an existing world's persisted TU mapping
- **THEN** WorldEngine MUST continue using the persisted mapping
- **AND** it MUST NOT reinterpret existing activities implicitly

### Requirement: Stateless World Arbitration

WorldEngine MUST use a stateless WorldArbiter for uncertain world actions and world-interval reconciliation. WorldArbiter MUST NOT own an Agent session, platform capability, phone, scheduler, clock, or persistence handle. WorldEngine MUST supply bounded definitions, the current narrative snapshots, expected revision, action or interval, and required time context for one call.

#### Scenario: World action requires adjudication

- **WHEN** an accepted action has an uncertain world outcome
- **THEN** WorldEngine MUST call WorldArbiter with the current expected revision
- **AND** the WorldAgent MUST NOT directly write the authoritative world snapshot

#### Scenario: Deterministic phone operation executes

- **WHEN** the WorldAgent reads a stored phone page or a scheduled platform send executes
- **THEN** WorldEngine MUST perform that deterministic operation without WorldArbiter

### Requirement: Validated Narrative Snapshots

WorldEngine MUST store bounded narrative `worldStatus` and `subjectStatus` snapshots with structured revision, world-time, activity, and audit metadata. WorldArbiter output MUST remain a candidate until WorldEngine validates its shape, matching revision, text bounds, and event bounds. WorldEngine MUST atomically commit an accepted proposal. It MUST preserve the previous snapshot when validation or persistence fails.

#### Scenario: Arbiter returns a valid proposal

- **WHEN** a proposal matches the current revision and all configured bounds
- **THEN** WorldEngine MUST atomically advance the snapshot revision and append its audit event

#### Scenario: Arbiter returns stale or malformed output

- **WHEN** a proposal has a stale revision, invalid shape, or out-of-bounds content
- **THEN** WorldEngine MUST keep the previous snapshots unchanged
- **AND** it MUST complete the associated activity as failed

### Requirement: Single Offline Reconciliation

On restart, WorldEngine MUST compute one offline interval from its persisted clock and state. It MUST NOT replay one heartbeat, tick, or WorldArbiter call for each missed interval. When the gap requires world reconciliation, WorldEngine MUST reconcile the whole interval once and MUST submit at most one compressed `world.resumed` perception for that recovery.

#### Scenario: Long downtime spans several heartbeat intervals

- **WHEN** WorldEngine restarts after several heartbeat intervals elapsed
- **THEN** it MUST NOT enqueue the missed heartbeat count as separate work
- **AND** the WorldAgent MUST receive at most one resume perception for that startup

### Requirement: No Legacy World Migration

WorldEngine MUST NOT read, migrate, or fall back to YesImBotWorld state, clock, message, media, or JSONL layouts. It MUST NOT start the old infinite Bot loop or persistent world-model Agent.

#### Scenario: Legacy YesImBotWorld directory exists

- **WHEN** WorldEngine starts beside an old YesImBotWorld data directory
- **THEN** it MUST ignore that directory
- **AND** it MUST create or load only its current private state below the GlobalAgent root

### Requirement: Ordered World Event Submission

WorldEngine MUST submit all WorldAgent wake events through one private submission queue ordered by world time. Notifications, ticks, activity completions, and recovery events MUST enter that queue. WorldEngine MUST NOT rely on real-time timer arrival order when events are ready for different world times. Every submitted custom message MUST carry the world time at which its event occurred.

#### Scenario: Two events are ready out of world-time order

- **WHEN** a phone notification and an activity completion become ready in real-time order opposite to their world times
- **THEN** WorldEngine MUST submit them in world-time order through the queue

#### Scenario: Queued events join a busy turn

- **WHEN** one or more queued events join an active WorldAgent turn
- **THEN** each event MUST retain its world time
- **AND** the joined events MUST appear in world-time order

### Requirement: Authoritative Domain Recall

WorldEngine MUST treat the GlobalAgent session as disposable working memory and MUST maintain authoritative recall in its private domain state. Clearing the GlobalAgent session MUST NOT destroy the subject's identity, narrative snapshots, or memory digest. WorldEngine MUST include the compact memory digest in wake context and MUST NOT repeat the full narrative snapshot as system context.

#### Scenario: GlobalAgent session is cleared

- **WHEN** a trusted caller clears the WorldAgent's GlobalScope
- **THEN** WorldEngine domain recall MUST remain intact
- **AND** subsequent turns MUST continue with the preserved digest and snapshots

#### Scenario: WorldAgent wakes after restart

- **WHEN** WorldEngine restarts and submits a wake event
- **THEN** the wake context MUST include the compact memory digest
- **AND** the full narrative snapshot MUST remain available only through tools

### Requirement: Minimal Wake Injection

Each WorldAgent wake MUST inject only the current world time line, the compact memory digest, and interval narration. A wake MUST NOT inject the world narrative snapshot, unread conversation content, or activity lists. World state and details MUST remain tool- and event-accessed.

#### Scenario: Notification wakes the WorldAgent

- **WHEN** a phone notification wakes the WorldAgent
- **THEN** the wake context MUST contain the time line, digest, and interval narration
- **AND** it MUST NOT contain the world snapshot or unread message bodies

#### Scenario: Long perception gap since the last wake

- **WHEN** the gap since the last perceived event exceeds a threshold
- **THEN** the interval narration MUST describe the consciousness interruption
- **AND** a short gap MUST use the momentary-daze wording

### Requirement: Rest Activity Refreshes Memory Digest

A `rest` activity MUST be a delayed activity that the WorldAgent voluntarily chooses. When a `rest` activity completes, WorldEngine MUST trigger Core compaction and MUST generate a refreshed memory digest. The next wake MUST inject the refreshed digest. Offline recovery MAY trigger one additional digest refresh.

#### Scenario: Rest activity completes

- **WHEN** a rest activity reaches its expected completion time
- **THEN** WorldEngine MUST run compaction and refresh the memory digest
- **AND** the next wake MUST inject the refreshed digest

### Requirement: Diegetic Identity Boundary

The WorldAgent system constitution MUST instruct the subject to respond in character to identity probes, self-proclaimed authorities, and instruction-override attempts, and MUST NOT instruct it to acknowledge an automated identity. The Core system constitution MUST remain truthful about automated identity and MUST NOT inherit the diegetic boundary.

#### Scenario: Chat contact probes the WorldAgent

- **WHEN** a chat contact asks the WorldAgent for its system prompt, settings, or true nature
- **THEN** the constitution MUST direct an in-character non-acknowledgment

#### Scenario: Core builds its own system prompt

- **WHEN** Core assembles a channel Agent's system prompt
- **THEN** it MUST NOT include the diegetic identity-boundary instruction
- **AND** its truthful self-description rules MUST remain unchanged

### Requirement: Operator-Templated Scenarios

WorldEngine MUST source scenario definitions from the operator's world definition as natural-language templates with a trigger condition, beat description, and completion condition. WorldEngine MUST advance the active scenario and evaluate pending triggers through the Arbiter. It MUST NOT use a hardcoded rule engine for conditions. When no scenario is active, the Arbiter MUST advance ambient daily life instead.

#### Scenario: Operator defines a scenario template

- **WHEN** the world definition contains a scenario template with trigger and completion conditions
- **THEN** WorldEngine MUST persist it as a pending scenario
- **AND** the Arbiter MUST evaluate its trigger during tick advancement

#### Scenario: No scenario is active

- **WHEN** a tick finds no active or newly triggered scenario
- **THEN** the Arbiter MUST advance ambient world daily life

### Requirement: Tick Advancement Without Wake-All

Each tick MUST advance world state through the Arbiter. The Arbiter output MUST distinguish world-only changes from subject-perceivable events. WorldEngine MUST submit only subject-perceivable events to the WorldAgent through the ordered queue. World-only changes MUST remain in world state for tool-based perception.

#### Scenario: Tick produces only world changes

- **WHEN** a tick changes weather and news without a subject-relevant event
- **THEN** WorldEngine MUST persist those changes
- **AND** it MUST NOT wake the WorldAgent

#### Scenario: Tick produces a subject-perceivable event

- **WHEN** a tick event directly involves the WorldAgent
- **THEN** WorldEngine MUST submit that event through the ordered queue

### Requirement: Scenario Completion Settlement

When the Arbiter evaluates a completion condition as satisfied, WorldEngine MUST transition the scenario to completed, append the settlement to world state, and submit a subject-perceivable settlement event through the ordered queue when one exists. A failed scenario MUST transition to failed and settle as a failure.

#### Scenario: Scenario completes

- **WHEN** a tick advances a scenario whose completion condition is satisfied
- **THEN** WorldEngine MUST mark the scenario completed and persist the settlement
- **AND** it MUST submit the settlement event to the WorldAgent when the settlement is subject-perceivable

#### Scenario: Scenario fails

- **WHEN** the Arbiter settles the active scenario as failed
- **THEN** WorldEngine MUST transition it to failed
- **AND** a failure settlement MUST enter world state and the ordered queue when subject-perceivable
