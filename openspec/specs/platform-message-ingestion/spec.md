# platform-message-ingestion Specification

## Purpose

Define Session Gateway entry points, per-platform Resolver registration, Resolver-owned image and text-file persistence, and scoped asset ownership.
## Requirements
### Requirement: Database-Backed Shared Channel Admission
Core MUST declare Koishi Database as a required dependency and MUST use the Koishi Channel row as the only assignee authority for shared Sessions. Gateway MUST query that row exactly once for each shared external Session, before Resolver selection, Store creation, persistence, Runtime creation, or other Runtime work. A successful Gateway check establishes the event's assignee snapshot.

#### Scenario: Current assignee sends an event
- **WHEN** Gateway receives a shared Session
- **AND** the database Channel identified by `platform` and `channelId` has `assignee` equal to `session.selfId`
- **THEN** Gateway MUST allow the Session to proceed to Resolver selection
- **AND** it MUST retain that successful check as the event's assignee snapshot

#### Scenario: Non-assignee sends an event
- **WHEN** the database assignee differs from `session.selfId`
- **THEN** Gateway MUST reject the Session before Resolver work, Store creation, persistence, or Runtime creation
- **AND** direct mention or command-prefix routing MUST NOT bypass this check for the YesImBot Agent Runtime

#### Scenario: Assignee cannot be resolved
- **WHEN** the Channel row is missing, assignee is empty, or the database query fails
- **THEN** Gateway MUST reject the shared Session without side effects
### Requirement: Direct Channel Admission

Gateway MUST isolate direct Sessions by their real `selfId` and MUST NOT use Koishi shared-channel assignee state for them.

#### Scenario: Direct Session arrives
- **WHEN** Gateway receives a direct Session
- **THEN** it MUST skip shared-channel assignee lookup
- **AND** it MUST preserve `session.selfId` in `ChannelScope`

### Requirement: Assignee Admission Snapshot
Core MUST use Gateway admission as the assignee snapshot for an ordinary admitted event and MUST NOT query shared-channel assignee state again before that event reaches Runtime submission or persistence. Reset does not require assignee validation.

#### Scenario: Assignment changes after Gateway admission
- **WHEN** Gateway admitted a shared Session
- **AND** the database assignee changes before Runtime submission
- **THEN** Core MUST continue to use the Gateway admission snapshot for that event
- **AND** it MUST NOT issue a second assignee query for that event

### Requirement: Session Gateway Entry Points
Core MUST admit ordinary messages through Koishi middleware and non-message Satori Sessions through `internal/session`. Gateway MUST ensure that one Session is resolved at most once and MUST NOT cache a resolved result for later lookup by Session identity.

#### Scenario: Ordinary message reaches middleware
- **WHEN** Koishi invokes the YesImBot middleware for a message Session
- **THEN** Gateway MUST resolve that Session in the middleware path
- **AND** the `internal/session` path MUST NOT resolve the same message Session

#### Scenario: Non-message Session reaches the internal hook
- **WHEN** `internal/session` receives a non-message Session
- **THEN** Gateway MUST attempt resolution in that hook
- **AND** it MUST NOT require a later middleware callback

### Requirement: Per-Platform Session Resolver
The public YesImBot facade MUST allow at most one `SessionResolver` registration per Koishi platform. A resolver MUST expose one asynchronous `resolve` method and the registration MUST return a disposer.

#### Scenario: Resolver registration succeeds
- **WHEN** a plugin registers the first resolver for a platform
- **THEN** Gateway MUST use that resolver for future Sessions on the platform

#### Scenario: Resolver registration conflicts
- **WHEN** a second resolver is registered for the same platform
- **THEN** registration MUST fail without replacing the active resolver

### Requirement: Atomic Session Resolution
Gateway MUST call the selected resolver once with `(session, store)`. The resolver MUST return a typed Message Draft, Event Draft, or `null`.

#### Scenario: Resolver accepts a Session
- **WHEN** a resolver returns a Draft
- **THEN** Gateway MUST construct the canonical MessageRecord or EventRecord and pass it to RuntimeManager
- **AND** it MUST NOT invoke a separate refine, prepare, or model-projector stage

#### Scenario: Resolver skips a Session
- **WHEN** a resolver returns `null`
- **THEN** core MUST NOT persist, route, or broadcast an Event for that Session

### Requirement: Authoritative Resolver Failure
A registered resolver MUST be authoritative for its platform. If its `resolve` call throws, Gateway MUST record a diagnostic and skip the Session without falling back to generic Satori conversion.

#### Scenario: Resolver throws
- **WHEN** the registered resolver throws while resolving a Session
- **THEN** Gateway MUST record a resolver diagnostic
- **AND** it MUST NOT create a fallback MessageRecord

#### Scenario: No resolver is registered
- **WHEN** a Session arrives for a platform without a resolver
- **THEN** Gateway MUST return without persisting or routing

### Requirement: Resolver-Owned Message Elements
A resolved ordinary message MUST carry its content as Resolver Draft `elements` only. Gateway MUST preserve successful Resolver elements and MUST NOT source-fill or rewrite image elements, run a second resource load, normalize or freeze elements, or retain the Session after its active handler completes.

#### Scenario: Resolver returns a message draft
- **WHEN** a resolver returns a message draft with elements
- **THEN** Gateway MUST persist those elements as the sole structured message content
- **AND** the persisted record MUST NOT contain a `text` field

#### Scenario: Resolver owns resource source handling
- **WHEN** a Resolver returns an image or file element
- **THEN** Gateway MUST preserve that successful Resolver output
- **AND** it MUST NOT replace source URLs, paths, data URIs, or already-persisted resource IDs

### Requirement: OneBot Resolver Resource Persistence
The OneBot Resolver MUST recursively persist `img` elements that it can load and return each successfully persisted image as `h("img", { id })`, where `id` is a complete 32-character lowercase hexadecimal ID. It MUST also persist `file` elements whose content is text, returning each as `h("file", { id, title })` where `title` is the observed filename. A successful persisted resource MUST contain no source URL, path, or data URI. The Resolver MAY apply platform-specific download limits; Core MUST NOT impose an inbound download policy.

A `file` element MUST qualify as text only when its filename carries a recognized text extension and its downloaded bytes decode as strict UTF-8. The extension check MUST precede the download so that non-text content is never fetched. A `file` element that fails either check MUST be preserved unchanged.

#### Scenario: OneBot persists an image
- **WHEN** a OneBot message contains an image whose bytes the Resolver successfully persists
- **THEN** the OneBot Resolver MUST write its bytes through the supplied Store
- **AND** the returned Draft MUST contain an `img` with its complete persisted ID

#### Scenario: OneBot persists a text file
- **WHEN** a OneBot message contains a `file` whose filename has a recognized text extension and whose bytes decode as strict UTF-8
- **THEN** the OneBot Resolver MUST write its bytes through the supplied Store
- **AND** the returned Draft MUST contain a `file` with its persisted ID and its observed filename as `title`

#### Scenario: OneBot preserves a non-text file
- **WHEN** a OneBot `file` element has no recognized text extension, or its downloaded bytes do not decode as strict UTF-8
- **THEN** the OneBot Resolver MUST preserve that original file element
- **AND** it MUST NOT download content whose extension is already disqualifying

#### Scenario: OneBot preserves a resource that cannot persist
- **WHEN** one OneBot image or file load or Store write fails
- **THEN** the OneBot Resolver MUST preserve that original element
- **AND** it MUST continue processing sibling elements

#### Scenario: Resolver failure is authoritative
- **WHEN** a Resolver itself throws while resolving a Session
- **THEN** Gateway MUST record a resolver diagnostic
- **AND** it MUST NOT persist or route that Session

### Requirement: OneBot Unpersisted Element Preservation
The OneBot Resolver MUST transform only `img` elements and qualifying text `file` elements. It MUST preserve every other Element's original type, attributes, and children unchanged while recursively processing persistable resources within those children. Session quote data is not an Element input protocol and receives no quote-specific normalization.

#### Scenario: Forward or unknown element is accepted
- **WHEN** an admitted OneBot message contains forward or any other element that is neither an image nor a qualifying text file
- **THEN** the Resolver output MUST retain their original type, attributes, and children
- **AND** it MUST NOT apply forward-specific normalization
### Requirement: Scoped Asset Service Ownership
The public AssetService MUST scope Stores by the persistent ChannelScope tuple. Shared Stores MUST use `[platform, channelId]`; a shared Runtime replacement for another Bot MUST use that same persistent tuple.

#### Scenario: Channel runtime projects a persisted image
- **WHEN** model projection reads an image reference from a persisted Message
- **THEN** it MUST load bytes only from the Store for the matching channel scope

#### Scenario: Channel reset clears assets
- **WHEN** RuntimeManager resets a channel
- **THEN** the reset MUST clear that channel's scoped assets without clearing another channel
### Requirement: Strict Channel Allowlist Admission
Core MUST expose `allowedChannels` as a strict Gateway allowlist. Each rule MUST contain `platform` and `channelId` as an exact string or `*`, and MAY contain boolean `isDirect`; omitted `isDirect` MUST match both direct and shared channels. Rules MUST use OR semantics, while every specified field in one rule MUST match. Missing configuration and an empty list MUST reject all external Sessions.

#### Scenario: Exact channel rule matches
- **WHEN** a Session's platform, channel ID, and direct classification match one allowlist rule
- **THEN** Gateway MUST continue normal assignment and Resolver admission

#### Scenario: String wildcard matches
- **WHEN** a rule uses `*` for platform or channel ID and its remaining fields match the Session scope
- **THEN** Gateway MUST admit the Session through the allowlist

#### Scenario: Direct classification is omitted
- **WHEN** a matching rule omits `isDirect`
- **THEN** the rule MUST match both direct and shared Sessions with the configured platform and channel ID

#### Scenario: Allowlist is missing or empty
- **WHEN** Core starts without any allowed channel rule
- **THEN** Gateway MUST reject every external Session
#### Scenario: No rule matches
- **WHEN** Gateway derives a valid ChannelScope but no allowlist rule matches it
- **THEN** Gateway MUST return before storage readiness, database assignee lookup, Resolver work, Store creation, Input creation, persistence, Will evaluation, or Runtime creation

#### Scenario: Internal delivery feedback is created
- **WHEN** an admitted ChannelRuntime reports same-channel `delivery.failed` feedback
- **THEN** Core MUST complete that internal Event through the producing Runtime without applying external Session allowlist admission again

### Requirement: Cached Runtime Assignee Mismatch
Core MUST replace a cached shared Runtime when an admitted event's `selfId` differs from that Runtime's `selfId`. Core MUST stop the old Runtime before creating the replacement, without changing the channel's persisted data.

#### Scenario: Admitted event reaches a Runtime for another self ID
- **WHEN** Gateway admitted a shared event under its assignee snapshot
- **AND** a cached Runtime for the same persistent shared tuple `[platform, channelId]` has a different `selfId`
- **THEN** Runtime routing MUST stop the cached Runtime and create a replacement for the admitted `selfId`
- **AND** it MUST preserve persisted channel data
