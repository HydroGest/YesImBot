# platform-event-contract Specification

## Purpose

Define the typed, publish-only contract for platform adapters to distribute non-message events to platform subscribers.

## Requirements

### Requirement: Publish-Only Structured Event

`Platform.Event` MUST contain source, scope, type, optional platform timestamp, typed structured data, and adapter-created frozen sanitized content. It MUST NOT contain core receipt time or a `receivedAt` field. `platform.publish(event)` MUST synchronously invoke event subscribers with the same semantic event. Core MUST NOT runtime-schema-validate the event or scan its data for JSON safety. Core MUST NOT create an agent custom message, write event data/content to channel JSONL, admit the event to LLM input, create an event archive, replay it, or route it to world state/willingness in this capability.

#### Scenario: Adapter creates event

- **WHEN** a platform adapter admits a supported non-message event
- **THEN** it MUST provide a complete semantic event with type, source, primary scope, optional platform timestamp, typed data, and frozen sanitized content
- **AND** the event MUST NOT include a core receipt timestamp
- **AND** core MUST distribute that event only to platform subscribers

#### Scenario: Subscriber receives event

- **WHEN** a platform subscriber receives a standardized event
- **THEN** it MUST be able to consume structured data without parsing frozen content
- **AND** no event custom message or JSONL entry MUST be created

#### Scenario: Ordinary message is collected

- **WHEN** core collects or persists a `Platform.Message`
- **THEN** it MUST NOT deliver that message to event subscribers

### Requirement: Extensible Typed Event Variants

The public event type surface MUST support declaration merging through `PlatformEventVariants`-style variants so plugins receive compile-time types for their own event data while core retains a JSON-safe runtime boundary.

#### Scenario: Plugin declares event variant

- **WHEN** a platform plugin augments the event variant map
- **THEN** code handling that type MUST receive the declared structured data type
- **AND** core MUST treat the declaration as the trusted event-data contract without runtime validation

### Requirement: Event-Only Public Publication

The public platform publication API MUST accept one complete `Platform.Event` and MUST NOT accept `Platform.Message` input. Core MUST synchronously publish the same semantic event without stamping, rewriting, or replacing it.

#### Scenario: External plugin publishes event

- **WHEN** an external plugin calls `platform.publish(event)` with a complete event
- **THEN** core MUST synchronously distribute that same semantic event to subscribers
- **AND** it MUST NOT add receipt metadata

#### Scenario: Plugin attempts direct message publication

- **WHEN** a plugin attempts to use public platform publication for an inbound message
- **THEN** the public API MUST NOT provide a Message publication path

### Requirement: Event Content Has No Generic Renderer

The creating adapter MUST create event frozen content once. Core MUST NOT require Fact, EventView, semantic renderer nodes, event templates, template tokens, or generic rerendering to distribute the event.

#### Scenario: Event is distributed

- **WHEN** core publishes a standardized event
- **THEN** it MUST distribute the adapter-frozen content unchanged by templates or Fact rendering
