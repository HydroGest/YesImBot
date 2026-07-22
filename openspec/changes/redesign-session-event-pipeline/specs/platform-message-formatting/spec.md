## ADDED Requirements

### Requirement: Event Model Projection
Core MUST project persisted `yesimbot.event` custom messages through one local Event projection path. Projection MUST read structured Satori resources and optional frozen content from `Event.data`. It MUST NOT invoke SessionResolver, Session, a platform API, or a replay-time platform formatter.

#### Scenario: Persisted message event is projected
- **WHEN** model projection receives an Event for `message`
- **THEN** core MUST derive its header from stored event resources
- **AND** it MUST derive its body only from the stored frozen content

#### Scenario: Event has no frozen content
- **WHEN** model projection receives an Event whose EventRecord has no content
- **THEN** default projection MUST emit no model message for that record

### Requirement: Fixed Core Event Envelope
Core MUST project a message event as one user model message with a fixed escaped key/value header, one newline, and the frozen content body. Resolver and platform plugins MUST NOT provide prompt headers, templates, AI SDK ModelMessages, or replay-time projection hooks.

#### Scenario: Message event is projected
- **WHEN** a persisted message event has frozen content
- **THEN** the resulting user message MUST begin with the fixed header
- **AND** exactly one newline MUST separate header and body

### Requirement: Deterministic Event Header Fields
The message-event header MUST include `time` and `sender`. It MUST include raw platform message `id` only when an active channel plugin declares the static `requiresMessageId` capability. Header values MUST use `JSON.stringify()` escaping.

#### Scenario: Sender resources are available
- **WHEN** an Event contains user and optional member display data
- **THEN** `sender` MUST use `displayName (userID)` when a display name exists
- **AND** it MUST use the raw user ID otherwise

#### Scenario: Message operation tools are unavailable
- **WHEN** no active channel plugin declares `requiresMessageId`
- **THEN** the header MUST omit `id`

### Requirement: Deterministic Event Time
Core MUST format the header time from the stored runtime event timestamp with the `zh-CN` locale, the `Asia/Shanghai` time zone, and minute precision.

#### Scenario: Event timestamp is projected
- **WHEN** core formats a persisted Event
- **THEN** the same stored timestamp MUST produce the same displayed time after restart

### Requirement: Local-Only Frozen Content Projection
Core MUST parse and transform only the stored frozen Koishi literal. Private image references MUST resolve only through the matching channel scope in AssetStore. Missing assets MUST produce diagnostics and MUST NOT trigger remote retrieval.

#### Scenario: Frozen private image is projected
- **WHEN** frozen content references an existing scoped image asset
- **THEN** core MUST produce a local model image part from AssetStore bytes

#### Scenario: Private asset is missing
- **WHEN** frozen content references a missing private asset
- **THEN** core MUST emit a diagnostic
- **AND** it MUST continue projection without a platform API call

### Requirement: No Initial Frozen Content Cap
Core MUST preserve the full frozen content for an accepted event except for explicit resource limits and event-specific resolver limits. It MUST NOT add a generic first-version content truncation step.

#### Scenario: Long ordinary message is projected
- **WHEN** a valid message event contains long text and remains within platform and model limits
- **THEN** core MUST retain the full frozen text in model projection

## REMOVED Requirements

### Requirement: Fixed Core Message Envelope

**Reason**: Projection now handles the common Event custom message instead of `Platform.MessageRecord`.

**Migration**: Use the replacement fixed core message envelope requirement in this delta spec.

### Requirement: Initial Header Fields

**Reason**: Header fields now derive from stored Satori event resources.

**Migration**: Use the deterministic event header fields requirement in this delta spec.

### Requirement: Deterministic Message Time

**Reason**: The source timestamp is now the EventRecord timestamp carried by Event.

**Migration**: Use the deterministic event time requirement in this delta spec.

### Requirement: No Initial Formatter Length Cap

**Reason**: The body is now resolved-event frozen content rather than a Platform message content string.

**Migration**: Use the no initial frozen content cap requirement in this delta spec.

### Requirement: Core Local-Only Element Projection

**Reason**: Projection now starts from `Event.data.content` and the shared scoped AssetStore.

**Migration**: Use the local-only frozen content projection requirement in this delta spec.
