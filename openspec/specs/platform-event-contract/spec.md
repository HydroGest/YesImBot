# platform-event-contract Specification

## Purpose

Define persisted message and non-message input contracts, their Satori-shaped resources, and committed input observation.

## Requirements

### Requirement: Split Persisted Input Contract
Core MUST persist ordinary channel messages as `yesimbot.message` and non-message channel events as `yesimbot.event`. Both payloads MUST require `schemaVersion: 1`; messages MUST contain `elements`, `messageId`, and frozen `text`, while events MUST contain `eventType` and frozen `text`.

#### Scenario: Input custom type is selected
- **WHEN** Core commits an ordinary message or a non-message event
- **THEN** it MUST use the corresponding custom type and MUST NOT use nested `message`, payload `content`, or payload `type` as a discriminant

### Requirement: Satori-Shaped Input Resources
Core MUST lift Satori user, channel, member, and guild resources into current input payloads and MUST NOT introduce parallel Source, Scope, or Sender models.

#### Scenario: A message is persisted
- **WHEN** Core creates a current Message
- **THEN** it MUST preserve its structured resources and source elements while storing timestamp only on the Agent custom message

### Requirement: Unsupported Version Rejection
Core MUST recognize only current `schemaVersion: 1` Message and Event payloads and MUST leave unsupported or missing-version JSONL entries untouched.

#### Scenario: Old payload is read
- **WHEN** history contains an unsupported or legacy custom payload
- **THEN** Core MUST not project it, feed it to Will, convert it, or rewrite its JSONL line

### Requirement: Committed Input Observation
Core MUST emit `yesimbot/event` after durable append and before Will evaluation for either current input variant.

#### Scenario: Current input is observed
- **WHEN** a current-format Message or Event is appended
- **THEN** observers MUST receive the committed input and a throwing observer MUST not undo persistence or prevent Will evaluation
