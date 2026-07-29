# platform-message-ingestion Specification

## Purpose

Define Session Gateway entry points, per-platform Resolver registration, Resolver-owned image persistence, and scoped asset ownership.
## Requirements
### Requirement: Database-Backed Shared Channel Admission
Core MUST declare Koishi Database as a required dependency and MUST use the Koishi Channel row as the only assignee authority for shared Sessions. Gateway MUST query that row exactly once for each shared external Session, before Resolver selection, image freezing, persistence, Runtime creation, or other Runtime work. A successful Gateway check establishes the event's assignee snapshot.

#### Scenario: Current assignee sends an event
- **WHEN** Gateway receives a shared Session
- **AND** the database Channel identified by `platform` and `channelId` has `assignee` equal to `session.selfId`
- **THEN** Gateway MUST allow the Session to proceed to Resolver selection
- **AND** it MUST retain that successful check as the event's assignee snapshot

#### Scenario: Non-assignee sends an event
- **WHEN** the database assignee differs from `session.selfId`
- **THEN** Gateway MUST reject the Session before Resolver work, image freezing, persistence, or Runtime creation
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
A registered resolver MUST be authoritative for its platform. If its `resolve` call throws or returns an invalid input record, Gateway MUST record a diagnostic and skip the Session without falling back to generic Satori conversion.

#### Scenario: Resolver throws
- **WHEN** the registered resolver throws while resolving a Session
- **THEN** Gateway MUST record a resolver diagnostic
- **AND** it MUST NOT create a fallback MessageRecord

#### Scenario: No resolver is registered
- **WHEN** a Session arrives for a platform without a resolver
- **THEN** Gateway MUST return without persisting or routing

### Requirement: Element-Based Resolved Message
A resolved ordinary message MUST carry its content as `elements` only. Gateway MUST seal those elements once at ingress and persist the sealed result as the sole structured content field. A resolver MUST NOT supply a rendered `text`, and Gateway MUST NOT persist one on a Message.

#### Scenario: Resolver returns a message draft
- **WHEN** a resolver returns a message draft with elements
- **THEN** Gateway MUST persist the sealed elements
- **AND** the persisted record MUST NOT contain a `text` field

#### Scenario: Draft contains an image carrying a source URL
- **WHEN** a message draft contains an image element with a remote source
- **THEN** the persisted `elements` MUST contain the sealed form of that image
- **AND** the persisted `elements` MUST NOT retain the original remote source

#### Scenario: Elements are sealed exactly once
- **WHEN** Gateway normalizes and seals a draft
- **THEN** normalization MUST NOT be applied more than once to the same elements

### Requirement: Resolver-Owned Bounded Image Freezing
Session resolution MUST finish every eligible image download before first persistence. It MUST enforce a maximum of 4 images, 5 MiB per image, 10 MiB total image bytes, 10 seconds per image, 2 concurrent downloads, and the MIME allowlist `image/jpeg`, `image/png`, `image/webp`, and `image/gif`. `freezeImage()` MUST call its loader as `load(signal, maxBytes)` using the remaining core-controlled budget; loaders MUST honor the signal and cap at transport/decode time. Timeout MUST abort the loader, return unavailable promptly, and retain its concurrency permit until that loader settles. AssetStore MUST determine accepted MIME from actual bytes; the loader MIME is only a hint.

#### Scenario: Eligible image is frozen
- **WHEN** an admitted message contains an allowed image within every limit
- **THEN** resolution MUST store the bytes in the scoped AssetStore
- **AND** the frozen content MUST reference the private asset ID

#### Scenario: Image cannot be frozen
- **WHEN** an image download fails, times out, exceeds a limit, or has a disallowed MIME type
- **THEN** resolution MUST replace it with a permanent unavailable element
- **AND** later model projection MUST NOT retry the remote resource

### Requirement: Fixed Forward and Quote Forms
Session resolution MUST keep forward elements as ID plus fixed summary and quote elements as ID only. Forward and quote elements MUST bypass binary resource collection.

#### Scenario: Forward element is accepted
- **WHEN** an admitted event contains a forward element
- **THEN** the structured and frozen representations MUST retain only its ID and fixed summary
- **AND** resolution MUST NOT store forwarded message bodies in AssetStore

#### Scenario: Quote element is accepted
- **WHEN** an admitted event contains a quote element
- **THEN** the structured and frozen representations MUST retain only its message ID

### Requirement: Shared Scoped Asset Ownership
One internal AssetStore MUST support Gateway `freezeImage()` writes, Message text projection reads, and ChannelRuntime cleanup. Assets MUST remain private to `channelIdentity` and MUST NOT become a public Koishi service.

#### Scenario: Channel runtime projects a frozen image
- **WHEN** model projection reads a private image reference from persisted Message text
- **THEN** it MUST load bytes only from the matching channel scope in AssetStore

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
- **THEN** Gateway MUST return before storage readiness, database assignee lookup, Resolver work, image freezing, Input creation, persistence, Will evaluation, or Runtime creation

#### Scenario: Internal delivery feedback is created
- **WHEN** an admitted ChannelRuntime reports same-channel `delivery.failed` feedback
- **THEN** Core MUST complete that internal Event through the producing Runtime without applying external Session allowlist admission again

### Requirement: Cached Runtime Assignee Mismatch
Core MUST replace a cached shared Runtime when an admitted event's `selfId` differs from that Runtime's `selfId`. Core MUST stop the old Runtime before creating the replacement, without changing the channel's persisted data.

#### Scenario: Admitted event reaches a Runtime for another self ID
- **WHEN** Gateway admitted a shared event under its assignee snapshot
- **AND** a cached Runtime for the same `channelIdentity` has a different `selfId`
- **THEN** Runtime routing MUST stop the cached Runtime and create a replacement for the admitted `selfId`
- **AND** it MUST preserve persisted channel data
