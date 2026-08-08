# ingress-record-boundary Specification

## Purpose
Define closed host-owned records and the Session boundary between Messenger ingress and Session-free runtime processing.

## Requirements

### Requirement: Closed Host-Owned Ingress Bases
Core MUST define versionless host-owned closed base shapes for persisted ordinary messages and non-message events. A message base contains `platform`, `selfId`, `channel`, `user`, `messageId`, `elements`, and `timestamp`; an event base contains `platform`, `selfId`, `channel`, `timestamp`, `eventType`, and `text`. Core MUST assemble these bases and admit only explicit declaration-merged variant fields.

#### Scenario: Messenger assembles a message record
- **WHEN** Core accepts an ordinary Translator result
- **THEN** the final persisted MessageRecord MUST contain only the fields named by the host message contract
- **AND** it MUST NOT inherit arbitrary fields from `session.event`

#### Scenario: Messenger assembles an event record
- **WHEN** Core accepts a non-message Translator result
- **THEN** the final persisted EventRecord MUST contain only the host event base and its declaration-merged variant fields
- **AND** it MUST NOT inherit arbitrary platform residue

### Requirement: Messenger Field Admission Authority
Messenger MUST be the single authority that converts a Translator result and the live Session envelope into a final persisted ingress record. It MUST derive canonical platform, current Bot, channel, user, timestamp, and message-ID boundary fields from the Session and ChannelScope; Translator output MUST NOT define the complete persisted envelope.

#### Scenario: Translator returns a record
- **WHEN** a Translator accepts a live Session
- **THEN** Messenger MUST route the assembled Session-free record to the channel runtime
- **AND** it MUST retain no Session reference after the active handler completes

### Requirement: Translator-Owned Resource Results
A Translator MAY persist inbound resources through the live ChannelResources owner. Messenger MUST preserve successful structured elements and MUST NOT re-request, source-fill, normalize, or freeze them in a second resource stage.

#### Scenario: Translator returns a persisted image
- **WHEN** a Translator returns an image with a complete persisted asset ID
- **THEN** Messenger MUST preserve that image without rewriting it

#### Scenario: Translator cannot persist one resource
- **WHEN** a Translator preserves an original resource after a load or write failure
- **THEN** Messenger MUST preserve the Translator result and continue routing according to the Translator contract

### Requirement: Forbidden Platform Residue Exclusion
Core MUST exclude adapter runtime residue such as `_data`, `_type`, `sn`, `login`, `guild`, `member`, `argv`, `friend`, `operator`, `emoji`, `role`, and `button` from persisted records unless an explicit host-owned or declaration-merged field reintroduces equivalent information.

### Requirement: Trusted Event Post Boundary
Core MUST accept a complete EventRecord from `ctx.yesimbot.messenger.post()` as trusted host ingress. This path MUST NOT require, retain, or fabricate a Session; call a Translator; or apply external allowlist and shared-assignee admission.

#### Scenario: Trusted event is committed
- **WHEN** a trusted plugin posts an EventRecord
- **THEN** Core MUST commit it through the existing closed event base and declared variant fields
- **AND** observers MUST receive the committed Event
