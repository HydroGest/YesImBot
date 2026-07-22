# platform-event-contract Specification

## Purpose

Define the Satori-shaped extensible EventMap, EventRecord types, accepted channel event persistence, typed committed event observation, and the separation between structured runtime event data and frozen model content.

## Requirements

### Requirement: Satori-Shaped Runtime Event Variants
Core MUST define an extensible `EventMap` and MUST derive each EventRecord from the Satori Event shape plus variant-specific required resources and optional frozen content. Message, user, member, guild, and channel resources MUST follow Satori resource lifting.

#### Scenario: Message event is narrowed
- **WHEN** core creates a `message` runtime event
- **THEN** `event.message`, `event.user`, and `event.channel` MUST be available as top-level resources
- **AND** consumers MUST NOT parse a parallel Source, Scope, or Sender model

#### Scenario: Plugin adds an event variant
- **WHEN** a plugin augments `EventMap`
- **THEN** TypeScript MUST infer the structured data for that event discriminant

### Requirement: Structured Event and Frozen Content Separation
A resolved event MUST contain one structured runtime event and MAY contain one separately frozen Koishi literal for model projection. The structured runtime event MUST NOT use the frozen literal as its semantic data model.

#### Scenario: Plugin consumes an event
- **WHEN** a plugin receives an Event
- **THEN** it MUST be able to read structured event resources and typed variant data without parsing frozen content

#### Scenario: Event has no model content
- **WHEN** a resolver accepts a structured event without model-facing content
- **THEN** the event MUST remain persistable and available to Will
- **AND** default model projection MUST emit no content body for it

### Requirement: Accepted Channel Event Persistence
Every EventRecord with a concrete channel MUST become one `yesimbot.event` Agent custom Event before Will evaluation. Core MUST NOT create a separate global event journal.

#### Scenario: Non-message event is accepted
- **WHEN** a SessionResolver returns a channel-scoped EventRecord
- **THEN** ChannelRuntime MUST wrap and append its Event to the channel JSONL history
- **AND** the record MUST preserve both structured event data and optional frozen content

#### Scenario: Event is skipped
- **WHEN** Gateway receives `null` from SessionResolver
- **THEN** no Event MUST be created

### Requirement: Initial Channel Scope Restriction
The first runtime version MUST route only events with a concrete `channel.id`. Channel-less guild or account events MUST be skipped without implicit fan-out or synthetic channel creation.

#### Scenario: Event has no channel
- **WHEN** a resolved candidate lacks `channel.id`
- **THEN** RuntimeManager MUST NOT create a ChannelRuntime or persist the event

### Requirement: Typed Committed Event Observation
Core MUST publish `yesimbot/event` through Koishi after an Event is durably appended and before Will decides. The event argument MUST be the committed Event discriminated union.

#### Scenario: Event record is committed
- **WHEN** ChannelRuntime successfully appends an Event
- **THEN** core MUST synchronously emit `yesimbot/event` with that record
- **AND** it MUST invoke Will only after the observation attempt

#### Scenario: Event observer fails
- **WHEN** a `yesimbot/event` listener throws
- **THEN** core MUST record a diagnostic
- **AND** it MUST continue to Will evaluation without undoing persistence
