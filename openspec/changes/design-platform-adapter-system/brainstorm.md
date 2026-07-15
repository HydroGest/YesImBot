<!--
Raw capture of the ongoing platform adapter design discussion.

This file records decisions confirmed by the user. design.md will later
reorganize the completed discussion into a technical design. Placeholder names
listed below are not approved API names.
-->

# Brainstorm: Platform Adapter System

## Background

YesImBot currently receives user messages through Koishi middleware. The core
service passes the Koishi `Session` through routing and reply handling, then
converts it into `PlatformMessage` for persistence and model projection.

The current boundary combines several concerns:

- Koishi event collection and middleware control flow.
- Satori message and resource interpretation.
- Platform-implementation corrections, such as OneBot implementation
  differences.
- Channel routing and turn triggering.
- Persistence policy.
- LLM-visible presentation.

Koishi and Satori already define a cross-platform event model, standard message
elements, `Session`, native event metadata, and adapter dispatch behavior.
YesImBot should build on those contracts instead of defining a parallel platform
protocol. Platform plugins still need a controlled way to recover information
that a Koishi adapter omits or represents differently.

## Source Findings

### Current YesImBot flow

- `core/src/service.ts` uses `handleSession()` for message routing, conversion,
  turn dispatch, observation append, error handling, and replies.
- `core/src/runtime/message.ts` converts `Session` into `PlatformMessage` and
  also defines the agent-runtime model projection for that message.
- The current persisted message keeps Satori content, while declared attachment
  and quote structures do not yet have a complete parsing path.

### Koishi and Satori dispatch

- Satori `Bot.dispatch(session)` synchronously emits `internal/session` before
  it emits the specific standard event or native event.
- `internal/session` covers inbound platform sessions that adapters submit
  through `Bot.dispatch()`.
- It does not cover every Koishi event whose callback happens to receive a
  `Session`. A plugin can construct a session and call `ctx.emit()` directly,
  and send or command lifecycle events use separate paths.
- `internal/session` is therefore the common input hook for Satori-compliant
  inbound platform events, not a universal hook for all Koishi events.

### OneBot verification

`koishi-plugin-adapter-onebot` 6.9.4 handles
`message_reactions_updated` by creating a session, setting its native OneBot
data, and calling `bot.dispatch(session)`. The event is visible to
`internal/session` with the native data already attached.

The package's declared event name and its runtime `type`/`subtype` representation
appear different. This reinforces the choice to collect dispatched sessions at
one common boundary instead of making YesImBot depend on every adapter-specific
event name.

## Approaches Considered

### Core-owned platform parsing rules

Core could parse each platform and protocol implementation directly. This gives
one predictable implementation but grows core around unstable platform details
and requires core releases for every compatibility fix.

### Fully plugin-owned adapters

Each adapter plugin could register Koishi listeners, parse events, decide
persistence and trigger behavior, and render final LLM text. This maximizes
plugin autonomy but duplicates common event handling, makes middleware ordering
observable, creates conflicting listeners, and produces inconsistent prompts.

### Layered core with narrow platform extensions

Core owns session collection, the stable internal data contract, validation,
routing policy, persistence policy, and final model presentation. Platform
extensions interpret only implementation-specific data and register schemas and
semantic presentation contributions for their own event or element types.

The user accepted this direction.

## Confirmed Decisions

### D1: Platform adapters produce platform facts only

The platform-specific conversion boundary may interpret, correct, and enrich
Koishi/Satori input. It must not decide:

- Whether an input starts an agent turn.
- Whether an input is persisted.
- The priority or outcome of future willingness evaluation.
- The final LLM-visible message format.

These decisions belong to separate core policies and upper-level systems.

### D2: Core owns final LLM presentation

Platform extensions may understand custom payload fields that core does not
know. They may register a constrained semantic conversion for those fields.
Core converts the resulting core-defined presentation model into final
`ModelMessage` or `UserContent` values.

This preserves platform-specific meaning without allowing each adapter to
replace sender formatting, timestamps, escaping, media policy, or the overall
prompt structure. User templates should consume the stable presentation model,
not raw platform payloads.

### D3: Events without a channel remain outside channel agents by default

Guild-level and account-level events enter the shared structured event flow.
Core must not invent a channel for them. A future routing policy or world-state
consumer may explicitly deliver them to one or more channel agents.

### D4: Core owns inbound Session collection

Core uses `internal/session` as the single collection point for inbound
platform sessions dispatched by Satori adapters. Platform adapter plugins do
not register their own Koishi listeners for those sessions.

Koishi middleware remains part of message control flow, but it does not create a
second copy of the message. It looks up or awaits the structured message created
from the same session, then applies message routing and reply behavior.

Core must deduplicate the `internal/session` and middleware paths by session
identity or another stable dispatch identity.

### D5: Provide an explicit publish extension

Sources that do not use Satori `Bot.dispatch()` need an explicit publication
API. This includes third-party data sources and custom Koishi events that bypass
`internal/session`.

The publication API is a separate input boundary. It does not justify letting
platform adapters register arbitrary listeners or bypass runtime validation.
Its exact accepted input type remains open.

### D6: Core fixes the common event structure

Plugins do not add arbitrary optional fields to the top level of every event.
Core owns the common structure and its versioning.

Plugins can extend two controlled maps:

- New namespaced event types with typed payloads.
- Namespaced extension data attached to standard events.

Each extension requires both TypeScript declaration merging and a runtime schema.
Declaration merging alone does not make persisted external data valid. Unknown
or invalid native events use an explicit unknown-event variant.

### D7: Satori content is the persisted message-content source of truth

YesImBot does not define a second general-purpose message element or attachment
protocol. Persisted message content uses the Satori element string.

Core derives plain text, media references, mentions, files, forwards, and the
LLM presentation when consumers need them. Platform-specific elements can use
registered interpretation rules. Information that Satori cannot represent can
use validated namespaced extensions.

A quote may remain a separate structured reference because Koishi `Session`
promotes the leading quote element into `event.message.quote`.

Core should not persist the Satori string, a duplicate element tree, a duplicate
attachment list, and duplicate plain text as competing sources of truth.

### D8: Messages and events share collection but remain distinct variants

Messages and non-message events share collection, conversion, validation, and a
common distribution mechanism. They remain discriminated types with separate
downstream policies.

- A created user message becomes one `PlatformMessage`; core does not emit a
  duplicate synonymous message-created event.
- Message edits, deletions, reactions, and other platform changes remain
  `PlatformEvent` values that reference the affected message.
- Message routing can choose observation, turn, or ignore behavior.
- Event consumers can update world state or feed the future willingness system.

### D9: Every structured input has one primary scope

Each message or event has one primary scope used for routing, persistence, and
authorization decisions. The initial semantic categories are:

- Conversation, where a channel identifier is required.
- Guild, where a guild identifier is required and no channel is invented.
- Account, for bot-account or direct platform-level events.

Other involved resources belong in the event payload. An event does not gain
multiple primary scopes merely because it references several entities.

Guild and thread identifiers may be absent from a conversation when the
platform or adapter does not provide them. The common type should not make every
identifier optional for every scope.

### D10: The public publication API accepts structured input only

The explicit publication API accepts a declared message or event input. Core
validates its event type, payload, extensions, source, and primary scope against
the registered runtime schemas before distribution.

The public API does not accept an arbitrary raw record or a Koishi `Session`.
Session collection remains an internal core path. A plugin that publishes a
custom event must register the event type and schema that make its payload
meaningful to the rest of the system.

Core may assign transport-owned metadata such as the internal record version or
receipt time. The source remains responsible for source facts such as the
platform occurrence time and native event identifier when they exist.

### D11: Core selects one platform-specific refiner per input

Core first derives a Satori-based result, then selects at most one matching
platform-specific refiner for the current input. Explicit implementation-profile
matches outrank Koishi adapter matches, which outrank platform matches. A tie is
a configuration error; core does not use registration order or numeric priority.
A refiner can decline an input and allow the next candidate to run. A failing
refiner does not silently select another implementation: core keeps a valid
Satori result for standard input or reports an unknown native result.

### D12: Implementation profiles are explicit and registrations are live

Core does not identify NapCat, Lagrange, or similar servers by fingerprinting
raw fields. A user-configured profile on the bot instance is authoritative. A
plugin can offer an optional probe with evidence and confidence, but it cannot
override explicit configuration. Unknown implementations use a generic refiner.

Platform plugins register refiners, schemas, element handlers, and semantic
contributions in a live core registry. Each registration returns a disposer.
New input observes current registration state, existing channel agents do not
need replacement, and duplicate adapter identifiers are errors.

### D13: No YesImBot capability abstraction

This design does not introduce a Capability type, registry, configuration
object, or future extension point. Satori `bot.features` only reports
experimental standard API availability from implemented bot methods; it does not
describe input parsing, server implementation identity, or account behavior.
Callers use platform API contracts and error handling directly.

### D14: Core recognizes inbound events and classifies outcomes strictly

Core recognizes every Satori-defined inbound Session event. Created messages
become messages, not duplicate events. Outgoing send lifecycle events and
deprecated bot aliases remain outside this system. Recognition alone does not
cause persistence, presentation, state update, or willingness evaluation.

Each standard event needs an event-specific minimum schema. Missing required
identity fields make the conversion invalid and produce diagnostics only. An
unregistered native event becomes a safe unknown result with known metadata and
is not admitted to history, LLM presentation, or willingness by default.

### D15: Stable facts retain neither raw data nor an event archive

Session, Bot, native raw data, and platform internal handles are transient.
Adapters can copy business-relevant data only into validated namespaced
extensions. Core creates no raw trace store, global event archive, replay store,
or cross-Session dedupe cache.

Core removes only the duplicate path where `internal/session` creates a message
and middleware routes that same Session. Platform retries remain visible, and
consumers with external side effects implement idempotency from source IDs.

Each fact has optional platform occurrence time and required core receipt time.
Receipt order controls notification; times do not drive deduplication. Entity
references require type and id and can retain Session-supplied display-name or
avatar snapshots. Core does not fetch profiles, persist complete resources, or
create a global entity cache.

### D16: Conversion is synchronous; core owns constrained presentation

Collection, Satori normalization, platform refinement, and schema validation are
synchronous and side-effect free. They do not call platform APIs, storage,
networks, or media services. Missing details remain references or omissions.
Core notifies consumers synchronously in receipt order for one bot; consumers
queue their own slow work and failures do not block other consumers.

Extensions convert validated payloads into finite core semantic nodes: actions,
entities, scalar facts, ordered lists, message references, media references, and
Satori content. They cannot return final prompt text, templates, or arbitrary AI
SDK content. Core applies user templates, escaping, limits, framing, and media
transport. Templates can alter body expression only and cannot read raw data or
control model roles.

Media defaults to safe metadata. Raw URLs and unknown attributes do not enter
prompt text, conversion never downloads media, and an image becomes a model part
only through separate explicit media handling. When channel policy persists a
non-message event, history stores source metadata, type, and semantic nodes, not
platform-specific payload. Messages retain Satori content.

### D17: Willingness consumes routed facts; adaptation remains inbound only

World state and routing resolve a relevant agent before future willingness
evaluation receives a structured fact. Adapters never label input as observation,
command, intent, or trigger candidate. Interaction commands remain platform
facts, and current deterministic direct-message, mention, and busy-join behavior
remains available. Guild and account events do not select a channel by default.

The adaptation system handles inbound facts only. Normal replies continue through
Koishi `session.send()` or bot APIs, while platform-specific outbound APIs remain
separate tool plugins. It defines no delivery, edit, delete, or output-adapter
interfaces.

### D18: Model-visible resource results are frozen before persistence

Resource access state and resolved content are different data. Session handles,
authentication tokens, download streams, and signed URLs remain transient.
Forward bodies, quote bodies, media metadata, and other resolved content become
durable snapshots when they will affect model input.

Core discovers stable references after synchronous conversion, performs any
configured asynchronous resolution, applies detail and truncation policy, and
freezes the result before the original message first enters agent storage.
`toModelMessages` performs no platform API calls, network access, downloads, or
resource resolution and deterministically renders the persisted message
snapshot. It may read an immutable channel-local asset by content hash to build
a persisted media part. A failed resolution stores a stable unavailable result
instead of changing old prompt content after a later retry.

### D19: Structured snapshots stay with messages; binary assets stay with channels

Bounded forward, quote, and media-metadata snapshots are stored with the original
message. Binary media that will remain model-visible is stored by content hash
under the current channel directory, and the message stores a stable asset
reference. Core does not add a cross-channel asset index or reference-counting
database. Channel reset can remove that channel's history and assets together.

A future version may introduce a unified resource center when real consumers
need cross-channel reuse. That design must first define ownership,
authorization, retention, and garbage collection; it is not part of the first
implementation.

The first implementation provides core-wide resource policy only. It controls
resolution switches, detail, nesting, request budgets, timeouts, media types, and
size limits. Platform plugins own API invocation details but cannot loosen core
budgets. New configuration applies to new messages; old snapshots are not
rewritten.

### D20: The public surface uses a short Platform namespace

The approved public direction uses `Platform.Message`, `Platform.Event`,
`Platform.Scope`, `Platform.Adapter`, `Platform.MessageView`,
`Platform.EventView`, and `Platform.Reader`. The core service exposes
`ctx.yesimbot.platform.register(extension)` and
`ctx.yesimbot.platform.publish(input)`.

No public common message-or-event union is required. Internal code can use a
direct union. The rejected working terms `Ingress`, `Projector`, `Envelope`,
`Activity`, `ProcessingScope`, and `Presentation` are not public API names.

## Provisional Data Flow

The accepted direction currently has these conceptual stages:

```text
Koishi/Satori Session or explicit publication
  -> common collection boundary
  -> Satori normalization
  -> selected platform-specific refinement
  -> runtime schema validation
  -> shared structured distribution
       -> persistence policy
       -> channel routing policy
       -> world state and future willingness system
       -> unified LLM presentation
  -> agent runtime append, send, or run
```

Messages and events share the stages through validation and distribution. Their
policies diverge after that point.

## Naming Status

No public API names have been approved. The user specifically rejected or
questioned the following working terms as too engineering-oriented or
semantically inaccurate:

- `Ingress`
- `Projector`
- `Envelope`
- `Activity`
- `ProcessingScope`

This document uses descriptive prose where possible. Any remaining occurrence
of those words is conceptual shorthand, not an API commitment. Naming will be a
separate design pass after responsibilities and data contracts stabilize.

## Open Questions

- What final names should replace the current working terms?
- What exact core semantic node vocabulary is sufficient for the first release?
- Which non-message consumers will ship first, and how will they route guild or
  account facts to world state or agent contexts?
- Which explicit media handling modes are valid for supported model providers?

## Current Non-Goals

- No implementation code is part of the current discussion phase.
- No compatibility with the discarded legacy platform gateway is required.
- No complete catalog of every platform-native event is required yet.
- No platform adapter may own agent intent, willingness, or final prompt policy.
