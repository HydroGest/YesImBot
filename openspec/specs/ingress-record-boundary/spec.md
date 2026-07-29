# ingress-record-boundary Specification

## Purpose

Define closed host-owned base shapes for persisted ordinary messages and non-message events while preserving declaration-merged event variants.

## Requirements

### Requirement: Closed Host-Owned Ingress Bases
Core MUST define versionless host-owned closed base shapes for persisted ordinary messages and persisted non-message events. A message base contains `platform`, `selfId`, `channel`, `user`, `messageId`, `elements`, and `timestamp`; an event base contains `platform`, `selfId`, `channel`, `timestamp`, `eventType`, and `text`. These base shapes MUST be assembled by Core rather than inherited from `Universal.Event`, and they MUST admit only fields explicitly declared by the host contract.

#### Scenario: Gateway assembles a message record
- **WHEN** Core accepts an ordinary message Session or resolver draft
- **THEN** the final persisted message record MUST contain only the fields named by the host message contract
- **AND** it MUST NOT inherit arbitrary fields from `session.event`

#### Scenario: Gateway assembles an event record
- **WHEN** Core accepts a non-message resolver draft
- **THEN** the final persisted event record MUST contain only the host event base fields plus the declaration-merged variant fields for its `eventType`
- **AND** it MUST NOT inherit arbitrary fields from `session.event`

### Requirement: Gateway Field Admission Authority
Gateway MUST be the single authority that converts resolver output into final persisted ingress records. A resolver MUST return a smaller host-defined draft and MUST NOT be trusted to define the complete persisted record envelope.

#### Scenario: Resolver returns a message draft
- **WHEN** a platform resolver accepts a Session as an ordinary message
- **THEN** Gateway MUST normalize that draft into the final persisted `MessageRecord`
- **AND** it MUST apply host field whitelisting before persistence or runtime routing

#### Scenario: Resolver returns an event draft
- **WHEN** a platform resolver accepts a Session as a non-message event
- **THEN** Gateway MUST normalize that draft into the final persisted `EventRecord`
- **AND** it MUST apply host field whitelisting before persistence or runtime routing

### Requirement: Forbidden Platform Residue Exclusion
Core MUST exclude platform runtime residue such as `_data`, `_type`, `sn`, `login`, `referrer`, `guild`, `member`, `argv`, `friend`, `operator`, `emoji`, `role`, and `button` from persisted ingress records unless a specific host-owned field explicitly reintroduces equivalent information.

#### Scenario: Fallback message path sees platform residue
- **WHEN** the Session event contains platform-specific runtime fields that are not part of the host message contract
- **THEN** the fallback message path MUST exclude them from the persisted message record

#### Scenario: Event variant needs platform-specific data
- **WHEN** an event variant needs a platform-specific fact such as a reaction list or poke target
- **THEN** the resolver MUST map that fact into explicit declaration-merged variant fields
- **AND** Core MUST NOT persist the raw platform residue that carried it
