## ADDED Requirements

### Requirement: Core-Owned Semantic Presentation

Core MUST convert standardized messages and events into a finite core-owned
semantic presentation model before producing model input. Platform extensions
MUST contribute only recognized semantic nodes such as actions, entity
references, scalar facts, ordered lists, message references, media references,
and Satori content. Extensions MUST NOT return final prompt text, templates, or
arbitrary AI SDK model messages.

#### Scenario: Custom reaction event
- **WHEN** a platform extension presents a validated custom reaction event
- **THEN** it MUST provide core semantic nodes for the action, involved entities,
  and facts
- **AND** core MUST produce the final model-visible content

#### Scenario: Unsupported event meaning
- **WHEN** a valid platform event cannot be expressed by the current semantic
  node vocabulary
- **THEN** core MUST require a general semantic node addition before admitting an
  extension-specific presentation
- **AND** the extension MUST NOT use an arbitrary text escape hatch

### Requirement: Template Boundaries

Core MUST apply user templates to stable semantic presentation data. Templates
MAY change body wording, field order, and optional fields for standard or
namespaced event types. Templates MUST NOT access raw payload or Session data,
create model roles, replace mandatory message boundaries, disable escaping or
length limits, or select media transport. Core MUST provide one generic fallback
body for an event without a user override.

#### Scenario: User overrides a custom event body
- **WHEN** a user provides a template for a registered namespaced event type
- **THEN** core MUST render that event body from semantic presentation data
- **AND** core MUST preserve its model role, framing, escaping, and length rules

#### Scenario: No template exists
- **WHEN** no user template matches an event
- **THEN** core MUST use its generic fallback body

### Requirement: Safe Media Presentation

Core MUST interpret Satori media elements as structured media references. Default
text presentation MUST show only safe media metadata and MUST NOT include raw
source URLs, arbitrary element attributes, automatic media downloads, or media
reads during input conversion. Audio, video, and file content MUST remain
metadata or explicit tool input in the first version. An image MUST become an AI
SDK media part only through separately configured media handling.

#### Scenario: Image contains a signed URL
- **WHEN** a Satori image element contains a URL with query parameters
- **THEN** core MUST NOT include that raw URL in model text
- **AND** core MUST render safe image metadata unless configured media handling
  supplies an image part

#### Scenario: Unknown platform element
- **WHEN** Satori content contains an unrecognized platform-namespaced element
- **THEN** core MUST use a safe placeholder or registered semantic interpretation
- **AND** core MUST NOT expose all element attributes to the model

### Requirement: Persistent Event Presentation

When channel policy admits a non-message event to agent history, core MUST store
the event source metadata, event type, and semantic presentation nodes. It MUST
NOT store platform-specific custom payload solely to support later model
presentation. Historical rendering MUST therefore remain available when the
original platform plugin is removed or upgraded.

#### Scenario: Platform plugin is removed
- **WHEN** channel history contains an admitted custom event and its original
  platform plugin is no longer registered
- **THEN** core MUST render the stored semantic nodes
- **AND** core MUST NOT require the removed plugin to interpret historical data

### Requirement: Pre-Persistence Resource Snapshots

Core MUST discover stable resource references without I/O during synchronous
platform conversion. When core policy enables resource resolution, core MUST
resolve selected references, apply configured detail and size limits, and freeze
the result before the original platform message first enters agent storage.
`toModelMessages` MUST NOT call platform APIs, access the network, download
resources, resolve unresolved references, or mutate the persisted resource
snapshot. It MAY read an immutable channel-local asset by content hash to build
a stable model media part.

#### Scenario: Forward content requires a platform API
- **WHEN** a new message contains a forward reference that the selected
  `Platform.Reader` can resolve and core policy enables forward resolution
- **THEN** core MUST resolve and bound the forward content before first agent
  persistence
- **AND** later model requests MUST render the frozen forward snapshot without
  calling the platform API again

#### Scenario: Resource resolution fails
- **WHEN** an enabled resource read fails, times out, or exceeds its budget
- **THEN** core MUST persist a stable unavailable resource snapshot
- **AND** later model requests MUST NOT opportunistically replace that snapshot
  with different content

#### Scenario: Persisted media is projected
- **WHEN** a persisted message references a validated channel-local asset by
  content hash
- **THEN** `toModelMessages` MAY read that immutable local asset to build the
  stored media part
- **AND** it MUST NOT contact the platform or network during projection

### Requirement: Deterministic Message Views

For the same persisted `Platform.Message`, renderer version, and template
configuration, core MUST produce the same model-visible content on every model
request. A configuration change MUST apply to newly persisted messages and MUST
NOT recompute or rewrite old resource snapshots.

#### Scenario: Tool loop rebuilds model history
- **WHEN** agent-runtime rebuilds model messages for a later step in the same turn
- **THEN** the persisted platform message MUST produce the same
  `Platform.MessageView`
- **AND** no resource read MUST occur during the rebuild

#### Scenario: Resource detail configuration changes
- **WHEN** an operator changes forward depth or detail configuration after a
  message was persisted
- **THEN** the old message MUST retain its original bounded resource snapshot
- **AND** the new configuration MUST apply only to later messages

### Requirement: Channel-Local Binary Assets

Binary media that will remain part of model-visible history MUST be validated,
hashed, and stored under the current channel's canonical directory before first
message persistence. A `Platform.Message` MUST retain a stable asset reference
instead of a temporary URL, token, stream, or inline duplicate. Core MUST NOT
create a cross-channel asset index or reference-counting database in the first
implementation.

#### Scenario: Image is admitted as a model media part
- **WHEN** media policy admits a downloaded image to persistent model history
- **THEN** core MUST store its bytes by content hash under the channel directory
- **AND** later model requests MUST build the media part from the stable channel
  asset reference

#### Scenario: Channel reset removes assets
- **WHEN** core resets a channel
- **THEN** core MUST clear that channel's persisted platform messages and binary
  assets

### Requirement: Core-Wide Resource Policy

The first implementation MUST use one core-wide resource policy for new
messages. It MUST define resource switches, detail level, nesting, count and
character limits, timeouts, concurrency, request budgets, permitted media types,
and byte limits. Platform readers MUST obey this policy and MUST NOT loosen its
limits. Core MUST NOT provide per-channel or per-user overrides in the first
implementation.

#### Scenario: Platform reader returns oversized content
- **WHEN** a platform reader returns content beyond the configured detail, count,
  character, or byte limit
- **THEN** core MUST truncate or reject the result according to core policy
- **AND** the platform reader MUST NOT override that decision

### Requirement: Structured Facts Before Willingness

Core MUST supply world state, routing, and future willingness consumers with
structured messages or events rather than model-rendered text. Platform
extensions MUST NOT classify input as observation, command, intent, or
trigger-candidate. Core MUST resolve a relevant agent or channel before sending
an input to willingness evaluation.

#### Scenario: Guild-scoped member event
- **WHEN** a guild-scoped member event has no explicit channel route
- **THEN** world-state consumers MAY receive the structured event
- **AND** core MUST NOT send it to a channel agent or willingness evaluation by
  default

#### Scenario: Interaction command
- **WHEN** a platform delivers an interaction command
- **THEN** core MUST treat it as a structured platform fact
- **AND** core MUST NOT treat it as an already recognized user intent
