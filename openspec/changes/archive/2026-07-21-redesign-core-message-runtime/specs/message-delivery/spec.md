## ADDED Requirements

### Requirement: Koishi-First Message Delivery

Core MUST provide one delivery capability that orchestrates passive replies and target-based channel sends through Koishi. Passive delivery MUST use the original Koishi Session so platform reply context remains available. Target delivery MUST resolve the Koishi Bot by platform and self ID and use the standard channel send operation. Core MUST NOT require a YesImBot platform driver or per-platform delivery adapter for either path.

#### Scenario: Reply to an admitted message

- **WHEN** a channel turn produces output for an admitted message
- **THEN** delivery MUST send that output through the original Koishi Session
- **AND** it MUST preserve the Session and Satori referrer context used by passive platforms

#### Scenario: Send to an explicit channel target

- **WHEN** a caller requests delivery with a platform, self ID, and channel scope but no originating Session
- **THEN** delivery MUST resolve the matching Koishi Bot
- **AND** it MUST send the output through the Bot's standard channel send operation

#### Scenario: Target Bot is unavailable

- **WHEN** target delivery cannot resolve an available Bot for the requested platform and self ID
- **THEN** delivery MUST return a structured failed receipt
- **AND** it MUST NOT attempt delivery through a different Bot

### Requirement: Ordered Logical Output

Delivery MUST accept ordered Koishi fragments and MUST submit them in the supplied order. Delivery MUST stop after the first failed logical fragment and MUST NOT replay fragments whose send calls already completed.

#### Scenario: All logical fragments succeed

- **WHEN** delivery receives multiple non-empty fragments and every Koishi send call succeeds
- **THEN** it MUST preserve fragment order
- **AND** it MUST return a `sent` receipt with the completed fragment count

#### Scenario: Later logical fragment fails

- **WHEN** one or more fragments complete and a later Koishi send call fails
- **THEN** delivery MUST return a `partial` receipt with the completed fragment count
- **AND** it MUST NOT send any remaining fragment or replay a completed fragment

#### Scenario: First logical fragment fails

- **WHEN** the first Koishi send call fails
- **THEN** delivery MUST return a `failed` receipt
- **AND** it MUST report zero completed fragments

### Requirement: Conservative Delivery Receipt

Each delivery operation MUST return a receipt with a delivery ID, mode, terminal status, completed fragment count, start time, finish time, the platform message ID array returned by completed Koishi send calls, and an optional normalized error. A `sent` receipt MUST mean only that the relevant Koishi send calls completed successfully. Core MUST NOT represent that result as accepted, delivered, read, exactly-once, or durably acknowledged.

#### Scenario: Passive reply returns message IDs

- **WHEN** `Session.send()` resolves with platform message IDs
- **THEN** delivery MUST preserve those IDs in the `sent` receipt

#### Scenario: Successful send returns an empty ID array

- **WHEN** a Koishi send call succeeds with an empty message ID array
- **THEN** delivery MUST return a `sent` receipt with `messageIds: []`
- **AND** it MUST NOT infer an accepted or delivered acknowledgement from that result

#### Scenario: Target send returns message IDs

- **WHEN** `Bot.sendMessage()` resolves with platform message IDs
- **THEN** delivery MUST preserve those IDs in the receipt

#### Scenario: Platform result is ambiguous

- **WHEN** a send call fails after the external platform may have accepted the message
- **THEN** delivery MUST return a normalized failure without automatic retry
- **AND** it MUST NOT claim exactly-once behavior

### Requirement: Delivery Status Observation

Delivery MUST publish one `delivery.started` event and exactly one terminal `delivery.sent`, `delivery.partial`, or `delivery.failed` event for each operation. Status listeners MUST be observational: their errors MUST NOT change delivery execution or its receipt, and listener completion MUST NOT delay the delivery result.

#### Scenario: Listener observes successful delivery

- **WHEN** a delivery operation succeeds
- **THEN** listeners MUST observe `delivery.started` before `delivery.sent`
- **AND** both events MUST carry the same delivery ID

#### Scenario: Listener fails

- **WHEN** a status listener throws or rejects
- **THEN** delivery MUST report a diagnostic for that listener failure
- **AND** it MUST continue the send operation and preserve its receipt

### Requirement: Koishi Encoder Ownership

Delivery MUST pass Koishi fragments to Session or Bot sending primitives and MUST leave platform encoding, splitting, media upload, native API calls, and Koishi `before-send` and `send` events to the installed Koishi/Satori adapter and MessageEncoder.

#### Scenario: Output contains structured elements

- **WHEN** delivery receives a fragment containing Koishi message elements
- **THEN** it MUST submit the fragment through the Koishi send primitive
- **AND** it MUST NOT pre-render a platform-specific payload

#### Scenario: Delivery itself fails

- **WHEN** core attempts to send a generic turn-failure reply and that delivery fails
- **THEN** delivery MUST emit one failed terminal status and a diagnostic
- **AND** core MUST NOT recursively attempt another error reply
