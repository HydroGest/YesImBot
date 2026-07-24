## ADDED Requirements

### Requirement: Strict Channel Allowlist Admission
Core MUST expose `allowedChannels` as a strict Gateway allowlist. Each rule MUST contain `platform` and `channelId` as an exact string or `*`, and MAY contain boolean `isDirect`; omitted `isDirect` MUST match both direct and shared channels. Rules MUST use OR semantics, while every specified field in one rule MUST match. Missing configuration and an empty list MUST reject all external Sessions.

#### Scenario: Exact channel rule matches
- **WHEN** a Session's platform, channel ID, and direct classification match one allowlist rule
- **THEN** Gateway MUST continue normal assignment and Resolver admission

#### Scenario: String wildcard matches
- **WHEN** a rule uses `*` for platform or channel ID and its remaining fields match the Session scope
- **THEN** Gateway MUST admit the Session through the allowlist

#### Scenario: Direct classification is omitted
- **WHEN** a matching rule omits `isDirect`
- **THEN** the rule MUST match both direct and shared Sessions with the configured platform and channel ID

#### Scenario: Allowlist is missing or empty
- **WHEN** Core starts without any allowed channel rule
- **THEN** Gateway MUST reject every external Session

#### Scenario: No rule matches
- **WHEN** Gateway derives a valid ChannelScope but no allowlist rule matches it
- **THEN** Gateway MUST return before storage readiness, database assignee lookup, Resolver work, image freezing, Event creation, persistence, Will evaluation, or Runtime creation

#### Scenario: Internal delivery feedback is created
- **WHEN** an admitted ChannelRuntime reports same-channel `delivery.failed` feedback
- **THEN** Core MUST complete that internal Event through the producing Runtime without applying external Session allowlist admission again
