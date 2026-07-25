## ADDED Requirements

### Requirement: Frozen Input Projection
Core MUST project current-format messages from stored resources and `text`, and MUST project events with a fixed safe wrapper containing only `eventType` and stored `text`.

#### Scenario: Restarted input is projected
- **WHEN** a current-format input is read from JSONL after restart
- **THEN** projection MUST use its persisted text without a Session, resolver, platform formatter, or replay-time rewrite

### Requirement: Local Frozen Media Selection
Core MUST discover private image references only from a copy of persisted message `text` and MUST leave JSONL fields unchanged.

#### Scenario: A private asset is selected
- **WHEN** persisted text references an eligible scoped private asset
- **THEN** Core MUST append the local file part without remote retrieval or mutation of text or elements
