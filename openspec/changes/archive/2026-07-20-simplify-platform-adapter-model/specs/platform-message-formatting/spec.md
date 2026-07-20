## ADDED Requirements

### Requirement: Fixed Core Message Envelope

Core MUST project an inbound platform message through one core-owned projection path that emits a fixed escaped key/value header, one newline, and text derived from sealed elements. Core MUST own field order, omission, escaping, element reading, local image projection, and the user model role. Header values MUST use `JSON.stringify()` encoding. Element reading MUST use Koishi element APIs (`h` parse/transform/stringify as needed). Adapters MUST NOT provide prompt headers, templates, `toModelMessages()` hooks, or AI SDK ModelMessages for ordinary inbound messages. Transform/projection helpers MUST NOT be required public plugin exports.

#### Scenario: Projection handles a message

- **WHEN** model projection handles a persisted inbound platform message
- **THEN** core MUST produce one user model message beginning with the fixed key/value header
- **AND** it MUST place content text after exactly one header/content newline
- **AND** it MUST NOT invoke a user-configurable template engine or adapter model-projection hook

### Requirement: Initial Header Fields

The envelope MUST emit `time` and `sender` in that order and MAY emit `id` between them only when an active channel plugin statically declares `requiresMessageId` because it exposes a message-operation tool. Core MUST derive this capability before creating the projection plugin; an adapter MUST NOT choose header fields. It MUST omit sender role in the first version. Header values MUST use one quoted escaping rule that prevents a value from creating a field, delimiter, or newline outside its own value.

#### Scenario: Message without a message-operation tool

- **WHEN** no active channel plugin declares `requiresMessageId`
- **THEN** the envelope MUST emit `time` followed by `sender`
- **AND** it MUST omit `id`

#### Scenario: Message with a message-operation tool

- **WHEN** an active channel plugin declares `requiresMessageId` for a message-operation tool
- **THEN** the envelope MUST emit raw platform message ID as quoted `id` between `time` and `sender`

#### Scenario: Sender has a display name

- **WHEN** the sender has display name and raw user ID
- **THEN** the envelope MUST emit `sender` as `display name (raw user ID)` in one escaped quoted value

#### Scenario: Header value contains control syntax

- **WHEN** a header value contains quotes, newlines, brackets, or equals signs
- **THEN** the envelope MUST escape it so it cannot create another header field or header/content boundary

### Requirement: Deterministic Message Time

The envelope MUST use valid platform timestamp when present, otherwise core receipt time. It MUST render the instant in `Asia/Shanghai` using `zh-CN` locale conventions with minute precision.

#### Scenario: Platform timestamp is unavailable

- **WHEN** a persisted message has no valid platform timestamp
- **THEN** the envelope MUST render receipt time as the `time` value with Asia/Shanghai minute precision

### Requirement: No Initial Formatter Length Cap

The initial projection MUST NOT truncate header values, element-derived text, or visible element attributes and MUST NOT expose a formatter length configuration.

#### Scenario: Long formatted message

- **WHEN** a persisted message contains long allowed text or allowed visible attributes
- **THEN** projection MUST encode the complete sealed value without adding a truncation marker

### Requirement: Core Local-Only Element Projection

Core MUST project sealed elements recursively and in document order without a platform API, network access, forward/quote lookup, or persisted-content mutation. Text and local image parts MUST preserve their source document order. For a multimodal model path, core MAY read a validated channel-local image asset identified by a sealed `<img>` asset reference and append its bytes to the same user model message. Core MUST NOT append bytes for audio, video, file, forward-tool media, or unavailable images.

#### Scenario: History is rebuilt

- **WHEN** agent-runtime rebuilds model history
- **THEN** core MUST use only persisted message data and local image assets
- **AND** it MUST NOT retry external image, forward, or quote access

#### Scenario: Nested content is projected

- **WHEN** a sealed element tree contains nested text and validated local image references
- **THEN** core MUST recursively project those nodes in document order
- **AND** it MUST preserve that order in the resulting text and image model parts

#### Scenario: Asset image is projected

- **WHEN** sealed elements reference a validated local image asset and the selected model path supports image input
- **THEN** core MAY append that local image to the same user model message
- **AND** it MUST NOT expose the original external image URL
