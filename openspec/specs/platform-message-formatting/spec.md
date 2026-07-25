# platform-message-formatting Specification

## Purpose

Define deterministic, local-only projection of persisted Message and Event custom messages into model input.

## Requirements

### Requirement: Frozen Input Projection
Core MUST project Messages from stored resources and frozen `text`, and MUST project Events through a fixed safe wrapper containing only `eventType` and stored `text`.

#### Scenario: Persisted message is projected
- **WHEN** model projection receives a current Message
- **THEN** it MUST derive a fixed header from stored resources and append the unchanged stored text after one newline

#### Scenario: Persisted event is projected
- **WHEN** model projection receives a current Event
- **THEN** it MUST emit a user message with the fixed notification wrapper and JSON-string encoded event type and text

### Requirement: Replay Uses Persisted Data
Projection MUST NOT invoke a SessionResolver, Session, platform API, or replay-time formatter and MUST NOT rewrite frozen text.

#### Scenario: Runtime restarts
- **WHEN** Core reads a current input from JSONL after restart
- **THEN** projection MUST use only its persisted fields

### Requirement: Local Frozen Media Selection
Core MUST discover private image references only from a copy of persisted Message `text`, resolve selected references through the matching scoped AssetStore, and leave JSONL fields unchanged.

#### Scenario: Private asset is selected
- **WHEN** stored text references an eligible private image asset
- **THEN** Core MUST append a local file part after original content without remote retrieval or mutation of text or elements
