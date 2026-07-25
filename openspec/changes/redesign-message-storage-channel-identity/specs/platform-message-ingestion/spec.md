## ADDED Requirements

### Requirement: Strict Ordinary Message Admission
Gateway MUST create a MessageRecord only for a `message-created` Session with routable scope, an elements array, and a non-empty platform message ID.

#### Scenario: Message source is captured
- **WHEN** an eligible message Session enters Gateway
- **THEN** Gateway MUST preserve source `elements` before lossy platform transformations and MUST freeze final model `text` separately

### Requirement: Resolver Input Union
Gateway and SessionResolver MUST exchange `MessageRecord | EventRecord` and MUST reject invalid resolver output without fallback.

#### Scenario: Resolver returns a non-message event
- **WHEN** a resolver accepts a non-message Session
- **THEN** it MUST provide `eventType`, required current schema version, and frozen `text`
