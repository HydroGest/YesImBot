# platform-message-formatting Specification

## Purpose

Define deterministic, local-only projection of persisted Message and Event custom messages into model input.

## Requirements

### Requirement: Frozen Input Projection
Core MUST project Messages from persisted sealed `elements`, rendering their text at projection time, and MUST project Events through a fixed safe wrapper containing only `eventType` and stored `text`. Core MUST NOT persist a rendered `text` field on a Message.

#### Scenario: Persisted message is projected
- **WHEN** model projection receives a current Message
- **THEN** it MUST derive a fixed header from stored resources and append text rendered from the persisted sealed `elements` after one newline

#### Scenario: Persisted event is projected
- **WHEN** model projection receives a current Event
- **THEN** it MUST emit a user message with the fixed notification wrapper and JSON-string encoded event type and text

#### Scenario: Same message is projected twice
- **WHEN** the same persisted Message is projected on two different turns
- **THEN** the rendered text MUST be byte-identical


### Requirement: Message Header Always Includes ID

Core MUST include the stored raw message ID in every projected Message header, together with its time and sender.

#### Scenario: A message is projected

- **WHEN** Core projects a persisted Message for a model call
- **THEN** its header MUST contain `time`, `sender`, and `id`
- **AND** this MUST NOT depend on the active Agent plugins or tools

### Requirement: Replay Uses Persisted Data
Projection MUST NOT invoke a SessionResolver, Session, platform API, or replay-time formatter, and MUST NOT mutate persisted `elements`. Rendering MUST be a pure function of persisted `elements`.

#### Scenario: Runtime restarts
- **WHEN** Core reads a current input from JSONL after restart
- **THEN** projection MUST use only its persisted fields
- **AND** the rendered text MUST equal the text rendered before restart
### Requirement: Local Frozen Media Selection
Core MUST discover private image references by walking persisted Message `elements`, resolve selected references through the matching scoped AssetStore, and leave persisted fields unchanged. Core MUST NOT recover asset references by parsing a rendered text projection.

#### Scenario: Private asset is selected
- **WHEN** persisted elements reference an eligible private image asset
- **THEN** Core MUST append a local file part after original content without remote retrieval or mutation of `elements`

#### Scenario: Text rendering format changes
- **WHEN** the text projection format is changed
- **THEN** asset discovery MUST be unaffected
