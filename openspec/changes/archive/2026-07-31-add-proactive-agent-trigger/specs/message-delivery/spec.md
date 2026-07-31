# message-delivery Specification Delta

## ADDED Requirements

### Requirement: Service-Owned Autonomous Bot Delivery

When a trusted trigger starts a turn, YesImBotService MUST consume that turn's sole output iterable and MUST send each ordered element segment through the current Bot that exactly matches the triggered EventRecord's `platform` and `selfId`. It MUST call `Bot.sendMessage()` with the EventRecord channel ID and MUST NOT require or fabricate a Session.

#### Scenario: Triggered turn yields structured output

- **WHEN** a triggered turn yields one or more assistant output segments
- **THEN** YesImBotService MUST send every segment through the matching Bot in produced order
- **AND** it MUST preserve structured elements without flattening them to text

#### Scenario: Triggered turn joins active work

- **WHEN** a trusted trigger joins an active turn
- **THEN** YesImBotService MUST NOT consume a second output iterable or send a duplicate reply

### Requirement: Shared Autonomous Delivery Outcomes

Autonomous Bot delivery MUST apply the same configured pacing, cancellation checks, first-success acknowledgement, empty-turn behavior, and first-failure stop behavior as Gateway passive delivery. A resolved empty Bot message-ID array MUST count as a successful send. A rejected Bot send MUST create exactly one same-channel `delivery.failed` EventRecord through the producing runtime and MUST stop later segments without retrying, recalling, or editing earlier sends.

#### Scenario: Autonomous Bot send succeeds without message IDs

- **WHEN** `Bot.sendMessage()` resolves with an empty string array for the first segment
- **THEN** Core MUST acknowledge the turn once
- **AND** Core MUST continue delivery of later segments according to configured pacing

#### Scenario: Autonomous Bot send fails

- **WHEN** `Bot.sendMessage()` rejects for a segment of a triggered reply
- **THEN** Core MUST route one `delivery.failed` EventRecord through the producing runtime
- **AND** Core MUST NOT send later segments of that reply
