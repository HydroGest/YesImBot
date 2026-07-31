# ingress-record-boundary Specification Delta

## ADDED Requirements

### Requirement: Trusted Host Event Admission

Core MUST accept a complete EventRecord from `ctx.yesimbot.trigger()` as trusted host ingress. It MUST commit that EventRecord using the existing closed event base and its declaration-merged variant fields. This path MUST NOT require, retain, or fabricate a Session; call a SessionResolver; or apply Gateway's external allowlist and shared-assignee admission checks.

#### Scenario: Trusted host event is committed

- **WHEN** Core or a trusted plugin triggers a complete EventRecord
- **THEN** Core MUST persist a `yesimbot.event` with the supplied host event base and declared variant fields
- **AND** observers MUST receive the committed Event

#### Scenario: Trigger targets a channel outside external admission

- **WHEN** a trusted trigger targets a channel that does not match Gateway's external allowlist
- **THEN** Core MUST NOT reject the trigger because of that allowlist
- **AND** Core MUST NOT construct or retain a Session for the event
