# platform-event-contract Specification

## Purpose

Define persisted message and non-message input contracts, their Satori-shaped resources, and committed input observation.

## Requirements

### Requirement: Split Persisted Input Contract
Core MUST persist ordinary channel messages as `yesimbot.message` and non-message channel events as `yesimbot.event`. Both payloads MUST require the current schema version. Messages MUST contain only the host-owned message contract fields, including `elements`, `messageId`, and frozen `text`. Events MUST contain a closed host-owned event base with `eventType` and frozen `text`, plus the flat declaration-merged variant fields for that `eventType`.

#### Scenario: Input custom type is selected
- **WHEN** Core commits an ordinary message or a non-message event
- **THEN** it MUST use the corresponding custom type
- **AND** it MUST NOT use nested `message`, payload `content`, or payload `type` as a discriminant

#### Scenario: Event variant is extended through declaration merge
- **WHEN** a platform adapter declaration-merges a new event variant into `EventMap`
- **THEN** persisted `yesimbot.event` payloads for that variant MUST contain the closed host event base fields plus the declaration-merged variant fields
- **AND** they MUST NOT inherit arbitrary `Universal.Event` resources by default

### Requirement: Satori-Shaped Input Resources
Core MUST keep using current Satori-shaped resources where they are explicitly part of the host ingress contract, and it MUST NOT introduce parallel Source, Scope, or Sender models. Core MUST NOT rely on inherited `Universal.Event` structure to carry optional platform resources into persisted ingress records.

#### Scenario: A message is persisted
- **WHEN** Core creates a current Message
- **THEN** it MUST preserve the message contract's structured resources and source elements while storing timestamp only on the Agent custom message
- **AND** it MUST NOT persist unrelated `Universal.Event` resources unless the message contract explicitly includes them

#### Scenario: An event is persisted
- **WHEN** Core creates a current Event
- **THEN** it MUST preserve the closed host event base and the declaration-merged variant fields for that event type
- **AND** it MUST NOT persist unrelated `Universal.Event` resources unless the event contract explicitly includes them

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
