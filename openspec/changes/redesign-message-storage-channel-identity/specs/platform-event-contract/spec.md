## ADDED Requirements

### Requirement: Split Persisted Input Contract
Core MUST persist ordinary channel messages as `yesimbot.message` and non-message channel events as `yesimbot.event`. Both payloads MUST require `schemaVersion: 1`; messages MUST contain `elements`, `messageId`, and frozen `text`, while events MUST contain `eventType` and frozen `text`.

#### Scenario: Input custom type is selected
- **WHEN** Core commits an ordinary message or a non-message event
- **THEN** it MUST use the corresponding custom type and MUST NOT use nested `message`, payload `content`, or payload `type` as a discriminant

### Requirement: Committed Input Observation
Core MUST emit `yesimbot/event` after durable append and before Will evaluation for either current input variant.

#### Scenario: Current input is observed
- **WHEN** a current-format Message or Event is appended
- **THEN** observers MUST receive the committed input and a throwing observer MUST not undo persistence or prevent Will evaluation
