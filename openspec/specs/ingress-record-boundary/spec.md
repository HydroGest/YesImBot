# ingress-record-boundary Specification

## Purpose

Define closed host-owned base shapes for persisted ordinary messages and non-message events while preserving declaration-merged event variants.

## Requirements

### Requirement: Closed Host-Owned Ingress Bases
Core MUST define versionless host-owned closed base shapes for persisted ordinary messages and persisted non-message events. A message base contains `platform`, `selfId`, `channel`, `user`, `messageId`, `elements`, and `timestamp`; an event base contains `platform`, `selfId`, `channel`, `timestamp`, `eventType`, and `text`. These base shapes MUST be assembled by Core rather than inherited from `Universal.Event`, and they MUST admit only fields explicitly declared by the host contract.

#### Scenario: Gateway assembles a message record
- **WHEN** Core accepts an ordinary message resolver draft
- **THEN** the final persisted message record MUST contain only the fields named by the host message contract
- **AND** it MUST NOT inherit arbitrary fields from `session.event`

#### Scenario: Gateway assembles an event record
- **WHEN** Core accepts a non-message resolver draft
- **THEN** the final persisted event record MUST contain only the host event base fields plus the declaration-merged variant fields for its `eventType`
- **AND** it MUST NOT inherit arbitrary fields from `session.event`

### Requirement: Gateway Field Admission Authority
Gateway MUST be the single authority that converts a Resolver Draft into a final persisted ingress record. The Draft is the sole record input: Gateway MUST NOT fall back to Session message fields when it is absent or incomplete, and it MUST NOT trust a Draft to define the complete persisted record envelope.

#### Scenario: Resolver returns a message draft
- **WHEN** a platform resolver accepts a Session as an ordinary message
- **THEN** Gateway MUST assemble the final persisted `MessageRecord` from the Draft and host-owned envelope fields
- **AND** it MUST apply host field whitelisting before persistence or runtime routing

#### Scenario: Resolver returns an event draft
- **WHEN** a platform resolver accepts a Session as a non-message event
- **THEN** Gateway MUST assemble the final persisted `EventRecord` from the Draft and host-owned envelope fields
- **AND** it MUST apply host field whitelisting before persistence or runtime routing

#### Scenario: Resolver persists an image
- **WHEN** a Resolver successfully persists an image in a Message Draft
- **THEN** that image MUST contain a complete 32-character lowercase hexadecimal ID
- **AND** Gateway MUST preserve it without Session-field fallback or image rewriting

#### Scenario: Resolver cannot persist one image
- **WHEN** a Resolver cannot persist one image while resolving a Message Draft
- **THEN** that Resolver MAY retain the original image source for that element
- **AND** Gateway MUST preserve the successful Draft rather than applying another image fallback

### Requirement: Forbidden Platform Residue Exclusion
Core MUST exclude platform runtime residue such as `_data`, `_type`, `sn`, `login`, `referrer`, `guild`, `member`, `argv`, `friend`, `operator`, `emoji`, `role`, and `button` from persisted ingress records unless a specific host-owned field explicitly reintroduces equivalent information.

#### Scenario: Resolver draft sees platform residue
- **WHEN** a platform resolver returns platform-specific data outside its declared draft
- **THEN** Gateway MUST exclude that residue from the persisted message record

#### Scenario: Event variant needs platform-specific data
- **WHEN** an event variant needs a platform-specific fact such as a reaction list or poke target
- **THEN** the resolver MUST map that fact into explicit declaration-merged variant fields
- **AND** Core MUST NOT persist the raw platform residue that carried it
