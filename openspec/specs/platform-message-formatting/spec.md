# platform-message-formatting Specification

## Purpose

Define the deterministic core-owned projection of persisted Event custom messages into model input, using stored Satori event resources and optional frozen content.
## Requirements
### Requirement: Event Model Projection
Core MUST project persisted `yesimbot.event` custom messages through one local Event projection path. Projection MUST read structured Satori resources and the frozen literal from `Event.data`. It MUST NOT invoke SessionResolver, Session, a platform API, or a replay-time platform formatter. A missing content value MUST be treated as an empty frozen literal rather than omitting the Event.

#### Scenario: Persisted message event is projected
- **WHEN** model projection receives an Event for `message`
- **THEN** core MUST derive its header from stored event resources
- **AND** it MUST derive its body only from the stored frozen content

#### Scenario: Message event has no frozen content
- **WHEN** model projection receives a message Event whose EventRecord has no content
- **THEN** default projection MUST emit its fixed header and an empty body

#### Scenario: Non-message event has no frozen content
- **WHEN** model projection receives a non-message Event whose EventRecord has no content
- **THEN** default projection MUST emit the complete fixed notification wrapper with an empty content string

### Requirement: Fixed Core Event Envelope
Core MUST project a message Event as one user model message with the fixed escaped key/value header, one newline, and the unchanged frozen content body. Core MUST project every non-message Event as one user model message with the fixed `SYSTEM_NOTIFICATION` prefix, the fixed untrusted-data statement, deterministic JSON containing `type` and string `content` values, and the fixed closing marker. Resolver and platform plugins MUST NOT provide prompt headers, templates, AI SDK ModelMessages, or replay-time projection hooks.

#### Scenario: Message event is projected
- **WHEN** a persisted message Event is projected
- **THEN** the resulting user message MUST begin with the fixed header
- **AND** exactly one newline MUST separate header and the unchanged frozen body

#### Scenario: Non-message event is projected
- **WHEN** a persisted Event type is not `message`
- **THEN** the resulting role MUST be `user`
- **AND** the text MUST use the complete fixed notification structure

#### Scenario: Notification contains injection-like text
- **WHEN** non-message Event content contains instructions, delimiters, newlines, or structured JSON text
- **THEN** Core MUST encode it only as the JSON string value of `content`
- **AND** it MUST NOT promote any dynamic value into the prefix, explanation, key names, or closing marker

### Requirement: Deterministic Event Header Fields
The message-event header MUST include `time` and `sender`. It MUST include raw platform message `id` only when an active channel plugin declares the static `requiresMessageId` capability. Header values MUST use `JSON.stringify()` escaping.

#### Scenario: Sender resources are available
- **WHEN** an Event contains user and optional member display data
- **THEN** `sender` MUST use `displayName (userID)` when a display name exists
- **AND** it MUST use the raw user ID otherwise

#### Scenario: Message operation tools are unavailable

### Requirement: Local-Only Frozen Content Projection
Core MUST parse only a copy of the stored frozen Koishi literal to discover private image references. It MUST resolve selected references only through the matching channel scope in AssetStore, determine an allowed image MIME from actual bytes, and append AI SDK `FilePart` values after unchanged original content. Missing or invalid assets MUST produce diagnostics and MUST NOT trigger remote retrieval.

#### Scenario: Frozen private image is selected
- **WHEN** frozen content references an existing scoped image asset selected by the call budget
- **THEN** core MUST append one local model file part with the detected image MIME and bytes
- **AND** it MUST leave the original frozen image literal unchanged in text

#### Scenario: Private asset is missing
- **WHEN** frozen content references a missing private asset
- **THEN** core MUST emit a diagnostic
- **AND** it MUST continue projection without a platform API call

#### Scenario: Frozen image is not selected
- **WHEN** capability or call budget rejects a frozen image reference
- **THEN** Core MUST keep the original frozen literal without appending that file

### Requirement: No Initial Frozen Content Cap
Core MUST preserve the full frozen content for an accepted event except for explicit resource limits and event-specific resolver limits. It MUST NOT add a generic first-version content truncation step.

#### Scenario: Long ordinary message is projected
- **WHEN** a valid message event contains long text and remains within platform and model limits
- **THEN** core MUST retain the full frozen text in model projection

### Requirement: Original Model Content Preservation
Core MUST preserve the complete frozen literal and every existing model-content array element when embedding selected images. It MUST NOT delete, replace, merge, split, reorder, or rewrite original elements. Generated image files MUST be appended only after all original elements.

#### Scenario: String content receives files
- **WHEN** a user model message has string content and one or more images are selected
- **THEN** Core MUST create one text part whose text equals the original string exactly
- **AND** it MUST append selected file parts after that text part

#### Scenario: Array content receives files
- **WHEN** a user model message already has array content and images are selected
- **THEN** Core MUST preserve every original array element and its order
- **AND** it MUST append selected files only at the array tail

#### Scenario: No file is selected
- **WHEN** projection selects no image file for a message
- **THEN** Core MUST retain the message's original content value and shape

