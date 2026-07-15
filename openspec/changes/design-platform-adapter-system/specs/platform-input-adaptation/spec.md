## ADDED Requirements

### Requirement: Core Session Collection

Core MUST collect every inbound platform Session dispatched through Satori
`Bot.dispatch()` from one `internal/session` boundary before platform-specific
event listeners or message middleware consume it. Middleware MUST use the
structured message associated with the same Session and MUST NOT create a second
platform message.

#### Scenario: Dispatched native platform event
- **WHEN** a Satori adapter attaches native data to a Session and calls
  `Bot.dispatch(session)`
- **THEN** core MUST observe the Session through the common collection boundary
- **AND** the selected platform refiner MUST receive the native data attached to
  that Session

#### Scenario: Middleware receives a dispatched message
- **WHEN** a dispatched message later reaches Koishi middleware
- **THEN** middleware MUST use the message already produced for that Session
- **AND** core MUST publish the message only once

### Requirement: Structured External Publication

Core MUST expose `ctx.yesimbot.platform.publish(input)` for sources outside
Satori dispatch. The method MUST accept only a declared `Platform.Message` or
`Platform.Event` input and MUST validate its source, `Platform.Scope`, event
type, payload, and extensions before distribution. The public API MUST NOT accept
a raw record or Koishi Session.

#### Scenario: External source publishes a registered event
- **WHEN** a plugin publishes an input for a registered event type with a valid
  payload and scope
- **THEN** core MUST assign core-owned receipt metadata
- **AND** core MUST distribute the validated event

#### Scenario: External source publishes raw data
- **WHEN** a plugin attempts to publish an untyped raw record or Koishi Session
- **THEN** core MUST reject the publication
- **AND** core MUST NOT distribute a platform fact

### Requirement: Deterministic Platform Refinement

Core MUST derive a Satori-based result before applying platform-specific
refinement. Core MUST select at most one matching refiner per input. Explicit
implementation profile matches MUST outrank Koishi adapter matches, which MUST
outrank platform matches. Core MUST use its Satori result when no refiner
matches.

#### Scenario: Explicit implementation profile
- **WHEN** an input matches a refiner for the explicitly configured bot profile
  and another refiner only matches its platform
- **THEN** core MUST select the profile-specific refiner

#### Scenario: Equal winning refiners
- **WHEN** two refiners have the same winning match for one input
- **THEN** core MUST report a configuration conflict
- **AND** core MUST NOT use registration order or numeric priority to choose one

#### Scenario: Refiner declines an input
- **WHEN** the highest matching refiner explicitly declines the current input
- **THEN** core MUST evaluate the next matching refiner

#### Scenario: Refiner fails
- **WHEN** a selected refiner fails while handling a standard Satori input
- **THEN** core MUST retain the valid Satori result and emit diagnostics
- **AND** core MUST NOT silently select another implementation-specific refiner

### Requirement: Explicit Implementation Identity

Core MUST treat an explicit user-configured profile as the authoritative
implementation identity for a bot instance. Core MUST NOT fingerprint native raw
fields to identify a server implementation. A plugin MAY provide an optional
probe, but the probe MUST NOT override explicit configuration.

#### Scenario: Unknown OneBot implementation
- **WHEN** a OneBot Session has no explicit implementation profile and no
  accepted probe result
- **THEN** core MUST use the generic protocol or platform refiner when available
- **AND** core MUST NOT infer a specific implementation from raw field shapes

### Requirement: Live Platform Registry

Core MUST expose `ctx.yesimbot.platform.register(extension)` backed by a live
registry for `Platform.Adapter`, event schemas, extension schemas, element
handlers, `Platform.Reader`, `Platform.MessageView`, and `Platform.EventView`
contributions. Each registration MUST return a disposer. New input MUST observe
the registry state at collection time; existing channel agent instances MUST NOT
require replacement when a registration changes. Duplicate adapter identifiers
MUST fail registration.

#### Scenario: Adapter plugin unloads
- **WHEN** a plugin invokes the disposer returned for its platform registration
- **THEN** new input MUST no longer use that registration
- **AND** already converted or persisted input MUST remain unchanged

### Requirement: Synchronous Side-Effect-Free Conversion

Collection, Satori normalization, platform refinement, and schema validation
MUST be synchronous and MUST NOT call platform APIs, databases, networks, or
media services. Missing data MUST remain absent or become a stable reference for
later consumers.

#### Scenario: Forward message detail is unavailable
- **WHEN** a platform input contains only a forward-message identifier
- **THEN** the refiner MUST preserve a reference or omission
- **AND** the refiner MUST NOT fetch forward-message content during conversion

### Requirement: Stable Platform Fact Boundaries

Core MUST own the common versioned structure for all standardized messages and
events. Plugins MUST extend only namespaced event payloads or namespaced
extension data. Every plugin extension MUST provide a runtime schema in addition
to TypeScript declaration merging. Stable facts MUST NOT retain raw Session, Bot,
or native event fields.

#### Scenario: Valid namespaced extension
- **WHEN** a plugin registers a namespaced extension schema and produces data
  that passes the schema
- **THEN** core MUST retain that extension under its namespace

#### Scenario: Type-only extension
- **WHEN** a plugin declares a TypeScript extension without registering a runtime
  schema
- **THEN** core MUST reject extension data for that namespace

### Requirement: Primary Scope and Entity References

Every standardized fact MUST have exactly one primary scope. A conversation
scope MUST require a channel identifier, a guild scope MUST require a guild
identifier, and an account scope MUST identify the bot account through its
source. Event payloads MUST carry other involved entities as role-specific
references. An entity reference MUST contain entity type and id and MAY contain
display-name or avatar snapshots supplied by the current Session.

#### Scenario: Guild member change without a channel
- **WHEN** a member-change event identifies a guild but no channel
- **THEN** core MUST create a guild-scoped event
- **AND** core MUST NOT invent a channel scope

#### Scenario: Historical display name
- **WHEN** a message or event includes an actor display name in its Session
- **THEN** core MUST retain that display snapshot with the entity reference
- **AND** core MUST NOT fetch a newer profile during conversion

### Requirement: Satori Message Content

Core MUST persist Satori message content as the sole message-content source of
truth. Core MUST derive text, mentions, media, files, and forwards from that
content when consumers need them. Core MAY retain the Session quote as a separate
structured reference. Core MUST NOT persist duplicate generic element trees,
attachment lists, or plain-text copies as competing message-content sources.

#### Scenario: Message with an image element
- **WHEN** a Satori message contains an image element
- **THEN** core MUST retain the Satori content
- **AND** later presentation MUST derive the image reference from that content

### Requirement: Standard Event Outcomes

Core MUST recognize Satori-defined inbound Session events. A created message
MUST become one message fact rather than a duplicate event fact. Standard events
MUST meet event-specific minimum schemas. Core MUST represent an unregistered
native event as a safe unknown result and MUST emit a diagnostic without
publishing a fact when a converter fails its claimed schema.

#### Scenario: Standard event lacks required identity
- **WHEN** a converter claims a standard event type but omits that event's
  required identity fields
- **THEN** core MUST emit a validation diagnostic
- **AND** core MUST NOT publish a partial standard event

#### Scenario: Unregistered native event
- **WHEN** core observes a native platform event without a registered converter
- **THEN** core MUST create only a safe unknown result with known metadata
- **AND** core MUST NOT admit it to history, LLM presentation, or willingness by
  default

### Requirement: Transient Processing and Distribution

Core MUST retain native raw data only during conversion. Each accepted fact MUST
have an optional source occurrence time and a required core receipt time. Core
MUST notify consumers synchronously in receipt order for one bot. Consumers MUST
own asynchronous work and idempotency. Core MUST remove only duplicate handling
of the same dispatched Session and middleware path; core MUST NOT implement
cross-Session replay deduplication, a global event archive, or a raw trace store.

#### Scenario: Replayed platform event
- **WHEN** a platform dispatches two separate Sessions with the same native
  message or event identifier
- **THEN** core MUST notify consumers of both inputs
- **AND** a consumer with external side effects MUST use source identifiers for
  its own idempotency

#### Scenario: Slow consumer
- **WHEN** one consumer performs slow asynchronous work after notification
- **THEN** it MUST NOT block synchronous collection or notification to another
  consumer

### Requirement: Inbound-Only Scope

The platform adaptation capability MUST handle inbound platform facts only. It
MUST NOT define delivery, send, edit, delete, or output-adapter interfaces.

#### Scenario: Normal assistant reply
- **WHEN** a channel agent produces a normal assistant reply
- **THEN** core MUST continue to send it through the existing Koishi Session or
  bot API path
- **AND** the platform adaptation capability MUST NOT select a delivery adapter
