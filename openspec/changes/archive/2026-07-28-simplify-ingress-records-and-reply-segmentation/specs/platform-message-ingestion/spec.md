## MODIFIED Requirements

### Requirement: Atomic Session Resolution
Gateway MUST call the selected resolver once with `ResolveContext` containing the
live Session and `freezeImage()`. The resolver MUST return a host-defined message
draft, a host-defined event draft, or `null`. Gateway MUST normalize that draft
into the final `MessageRecord` or `EventRecord`, and it MUST remain the only layer
that assembles the persisted ingress envelope.

#### Scenario: Resolver accepts a Session
- **WHEN** a resolver returns a resolved draft for an ordinary message or
  non-message event
- **THEN** Gateway MUST normalize that draft into the final persisted input record
- **AND** it MUST pass the resulting `MessageRecord` or `EventRecord` to
  RuntimeManager
- **AND** it MUST NOT invoke a separate refine, prepare, or model-projector stage

#### Scenario: Resolver skips a Session
- **WHEN** a resolver returns `null`
- **THEN** Core MUST NOT persist, route, or broadcast an Event for that Session

### Requirement: Satori Message Fallback
When a platform has no registered resolver, Gateway MUST convert a standard
message Session from Satori resources and MUST skip non-message Sessions. The
fallback path MUST assemble a closed host-owned `MessageRecord` using only the
host contract fields and MUST NOT spread arbitrary `session.event` residue into
the persisted record.

#### Scenario: Message has no platform resolver
- **WHEN** middleware receives a valid Satori message Session for a platform
  without a resolver
- **THEN** Gateway MUST create a `MessageRecord` only when the Session has a
  routable scope, elements array, and non-empty platform message ID
- **AND** it MUST capture source elements before transformations and freeze final
  message text before routing
- **AND** it MUST exclude platform runtime residue that is not named by the host
  message contract

#### Scenario: Non-message Session has no platform resolver
- **WHEN** `internal/session` receives a non-message Session for a platform
  without a resolver
- **THEN** Gateway MUST return without routing the Session
