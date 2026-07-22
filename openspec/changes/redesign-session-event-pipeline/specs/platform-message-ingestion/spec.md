## ADDED Requirements

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
Gateway MUST call the selected resolver once with ResolveContext containing the Session, an optional Satori-derived message base, and `freezeImage()`. The resolver MUST return EventRecord or `null`.

#### Scenario: Resolver accepts a message Session
- **WHEN** a resolver returns a resolved event
- **THEN** Gateway MUST pass the EventRecord to RuntimeManager
- **AND** it MUST NOT invoke a separate refine, prepare, or model-projector stage

#### Scenario: Resolver skips a Session
- **WHEN** a resolver returns `skip`
- **THEN** core MUST NOT persist, route, or broadcast an Event for that Session

### Requirement: Authoritative Resolver Failure
A registered resolver MUST be authoritative for its platform. If its `resolve` call throws or returns an invalid EventRecord, Gateway MUST record a diagnostic and skip the Session without falling back to generic Satori conversion.

#### Scenario: Resolver throws
- **WHEN** the registered resolver throws while resolving a Session
- **THEN** Gateway MUST record a resolver diagnostic
- **AND** it MUST NOT create a fallback message event

### Requirement: Satori Message Fallback
When a platform has no registered resolver, Gateway MUST convert a standard message Session from Satori resources and MUST skip non-message Sessions.

#### Scenario: Message has no platform resolver
- **WHEN** middleware receives a valid Satori message Session for a platform without a resolver
- **THEN** Gateway MUST create a `message` EventRecord
- **AND** it MUST freeze the message content before routing

#### Scenario: Non-message Session has no platform resolver
- **WHEN** `internal/session` receives a non-message Session for a platform without a resolver
- **THEN** Gateway MUST return without routing the Session

### Requirement: Element-Based Resolved Message
An accepted message event MUST retain normalized Koishi elements in its structured Satori message resource and MUST carry a separate frozen Koishi literal for model projection. Core MUST NOT introduce a parallel part, view, snapshot, reference, or reader representation.

#### Scenario: Resolver accepts a rich message
- **WHEN** a message contains text, mentions, quotes, forwards, or supported media
- **THEN** the structured runtime event MUST expose normalized Koishi message elements
- **AND** the resolved content MUST contain their sealed literal representation

### Requirement: Resolver-Owned Bounded Image Freezing
Session resolution MUST finish every eligible image download before first persistence. It MUST enforce a maximum of 4 images, 5 MiB per image, 10 MiB total image bytes, 10 seconds per image, 2 concurrent downloads, and the MIME allowlist `image/jpeg`, `image/png`, `image/webp`, and `image/gif`.

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
One internal AssetStore MUST support Gateway `freezeImage()` writes and Event formatter reads plus ChannelRuntime cleanup. Assets MUST remain private to the canonical channel identity and MUST NOT become a public Koishi service.

#### Scenario: Channel runtime projects a frozen image
- **WHEN** model projection reads a private image reference from Event data
- **THEN** it MUST load bytes only from the matching channel scope in AssetStore

#### Scenario: Channel reset clears assets
- **WHEN** RuntimeManager resets a channel
- **THEN** the reset MUST clear that channel's scoped assets without clearing another channel

## REMOVED Requirements

### Requirement: Incompatible Element-Based Platform Message

**Reason**: `Platform.Message` is replaced by Satori-shaped runtime events plus separate frozen content.

**Migration**: Platform plugins MUST return EventRecord or `null` from `SessionResolver.resolve()`.

### Requirement: Flat Adapter Refinement Contract

**Reason**: The multi-stage adapter contract requires Session-linked state and splits one resolution flow.

**Migration**: Replace `accepts`, `refine`, and result variants with one per-platform `SessionResolver.resolve(ResolveContext)` call.

### Requirement: Adapter-Limited Message Preparation

**Reason**: Resource preparation now occurs inside the single resolver call before routing.

**Migration**: Move platform-specific image loading into `SessionResolver.resolve()` and pass it through `ResolveContext.freezeImage()`.

### Requirement: ImagePrepareSink Boundary

**Reason**: The sink is no longer exposed through an adapter prepare stage.

**Migration**: Use the resource-freezing capability supplied to the resolver.

### Requirement: Bounded Pre-Persistence Image Freezing

**Reason**: The behavior remains but ownership and terminology change from adapter preparation to atomic Session resolution.

**Migration**: Follow the replacement requirement in this delta spec.

### Requirement: Fixed Forward and Quote Element Forms

**Reason**: The behavior remains but now applies to resolved runtime events rather than `Platform.Message` preparation.

**Migration**: Follow the replacement requirement in this delta spec.

### Requirement: Minimal Element Allowlist Normalization

**Reason**: Normalization is incorporated into Session resolution and the structured Satori message model.

**Migration**: Resolver and fallback implementations MUST normalize Koishi elements before producing frozen content.

### Requirement: Fallback Without Adapter Preparation

**Reason**: Adapters are replaced by per-platform resolvers, and fallback now performs complete safe freezing.

**Migration**: Use the Satori message fallback requirement in this delta spec.

### Requirement: No Initial Ordinary-Content Cap

**Reason**: Ordinary-content behavior is now governed by resolved event content rather than a Platform message preparation stage.

**Migration**: Preserve uncapped ordinary frozen content unless a later capability defines a limit.

### Requirement: Narrow Channel-Local Asset Ownership

**Reason**: AssetStore is shared through composition while enforcing channel-scoped access.

**Migration**: Use the shared scoped asset ownership requirement in this delta spec.
