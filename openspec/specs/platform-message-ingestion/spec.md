# platform-message-ingestion Specification

## Purpose
Define Session-live Messenger entry, Translator selection, inbound resource persistence, and Session-free record routing.

## Requirements

### Requirement: Database-Backed Shared Channel Admission
Core MUST declare Koishi Database as a required dependency and MUST use the Koishi Channel row as the only assignee authority for shared Sessions. Messenger MUST query that row once for each shared external Session before Translator selection, ChannelResources resolution, persistence, runtime creation, or other runtime work. A successful check establishes the event's assignee snapshot.

#### Scenario: Current assignee sends an event
- **WHEN** Messenger receives a shared Session whose database assignee equals `session.selfId`
- **THEN** Messenger MUST allow the Session to proceed to Translator selection
- **AND** it MUST retain that successful check as the event's assignee snapshot

#### Scenario: Non-assignee sends an event
- **WHEN** the database assignee differs from `session.selfId`
- **THEN** Messenger MUST reject the Session before Translator, resource, persistence, or runtime work
- **AND** mention or command routing MUST NOT bypass this check

### Requirement: Direct Channel Admission
Messenger MUST isolate direct Sessions by their real `selfId` and MUST NOT use shared-channel assignee state for them.

#### Scenario: Direct Session arrives
- **WHEN** Messenger receives a direct Session
- **THEN** it MUST skip shared-channel assignee lookup
- **AND** it MUST preserve `session.selfId` in ChannelScope

### Requirement: External Session Entry And Deduplication
Messenger MUST admit ordinary messages through Koishi middleware and non-message Sessions through `internal/session`. It MUST resolve each live Session at most once and MUST NOT cache resolved results for later lookup by Session identity.

#### Scenario: Ordinary message reaches middleware
- **WHEN** Koishi invokes Messenger middleware for a message Session
- **THEN** Messenger MUST resolve it in the middleware path
- **AND** the internal/session path MUST NOT resolve the same Session again

#### Scenario: Non-message Session reaches the internal hook
- **WHEN** `internal/session` receives a non-message Session
- **THEN** Messenger MUST attempt resolution in that hook without requiring later middleware

### Requirement: Translator Registration And Selection
The public `ctx.yesimbot.messenger.use(translator)` MUST allow at most one Translator for each platform and MUST return a disposer. A matching exact platform Translator takes precedence over explicit `*` wildcard selection; when no Translator exists, the built-in message pass-through may handle ordinary message-created input only. A registered Translator is authoritative and does not fall back after throwing or returning null.

#### Scenario: Translator registration conflicts
- **WHEN** a second Translator is registered for the same platform
- **THEN** registration MUST fail without replacing the active Translator

#### Scenario: Translator skips input
- **WHEN** the selected Translator returns `null`
- **THEN** Core MUST NOT persist or route a record for that Session

### Requirement: Session-Live Translation
Messenger MUST call the selected Translator with `(session, resources)` while the Session is live. The Translator owns platform-specific downloads and may persist accepted assets or artifacts through ChannelResources. Runtime, Agent history, Will state, and JSONL MUST retain no Session reference. The OneBot Resolver MUST recursively persist `img` elements that it can load. For each successful persistence, it MUST write bytes through the supplied Store, receive a complete 32-character lowercase hexadecimal asset ID, and return `h("img", { id })`. A successful persisted image MUST contain no source URL, path, or data URI. The Resolver MAY apply platform-specific download limits; Core MUST NOT impose an inbound image-download policy.

#### Scenario: OneBot persists an image
- **WHEN** a OneBot message contains an image whose bytes the Resolver successfully persists
- **THEN** the OneBot Resolver MUST write its bytes through the supplied Store
- **AND** the returned Draft MUST contain an `img` with its complete persisted ID

#### Scenario: OneBot preserves an image that cannot persist
- **WHEN** one OneBot image load or Store write fails
- **THEN** the OneBot Resolver MUST preserve that original image element
- **AND** it MUST continue processing sibling elements
### Requirement: Authoritative Translation Failure
A Translator failure MUST be recorded diagnostically and MUST skip the Session without generic Satori fallback. A platform without a Translator MUST return without persisting or routing unless the built-in ordinary message pass-through applies.

### Requirement: Strict Channel Allowlist
Core MUST expose `allowedChannels` as a deny-by-default external Messenger allowlist. Rules MUST use OR semantics; specified fields within one rule MUST use AND semantics; `platform` and `channelId` accept exact strings or `*`; omitted directness matches both kinds. A non-matching Session MUST be rejected before resource readiness, assignee lookup, Translator work, persistence, Will evaluation, or runtime creation.

#### Scenario: Empty allowlist
- **WHEN** Core starts without an allowed channel rule
- **THEN** Messenger MUST reject every external Session

#### Scenario: Internal delivery feedback
- **WHEN** a producing runtime reports `delivery.failed`
- **THEN** Core MUST append it through that runtime without applying external allowlist admission

### Requirement: Runtime Replacement For Shared Bot
Core MUST replace a cached shared runtime when an admitted event's current Bot selfId differs from that runtime's selfId. It MUST stop the old runtime first and preserve channel data.
