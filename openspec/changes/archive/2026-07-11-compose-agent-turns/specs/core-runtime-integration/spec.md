## MODIFIED Requirements

### Requirement: Message Routing

Core MUST append ordinary group messages and process direct or mentioned messages through the channel runtime.

#### Scenario: Ordinary group message

- **WHEN** core receives a non-self group message that does not mention the bot
- **THEN** it MUST call `agent.append()` with the platform message
- **AND** it MUST NOT trigger a reply by itself

#### Scenario: Direct message

- **WHEN** core receives a non-self direct message
- **THEN** it MUST process the platform message through `agent.run()`
- **AND** it MUST consume the returned turn-scoped stream before rendering replies

#### Scenario: Group mention

- **WHEN** core receives a non-self group message that mentions the bot
- **THEN** it MUST process the platform message through `agent.run()`
- **AND** it MUST consume the returned turn-scoped stream before rendering replies

#### Scenario: Busy direct or mentioned message

- **WHEN** a direct or mentioned message arrives while the channel runtime has an active turn
- **THEN** core MUST send it with join behavior so it enters the active turn as explicit joined input

#### Scenario: Run stream consumption shape

- **WHEN** core starts a direct or mentioned turn
- **THEN** it MAY assign the `run()` result to a local stream variable and consume it with `for await`
- **AND** it MUST NOT depend on a public `waitTurn(turnId)` API

### Requirement: Assistant Reply Rendering

Core MUST send all non-empty assistant text messages produced by a direct or mentioned message turn.

#### Scenario: Multiple assistant texts from run stream

- **WHEN** a direct or mentioned turn emits one or more turn-scoped `message.appended` events whose message role is `assistant` and text is non-empty
- **THEN** core MUST send each corresponding text message to the Koishi channel in generation order

#### Scenario: Empty or non-assistant output

- **WHEN** the turn stream contains empty assistant text, tool messages, or non-text content only
- **THEN** core MUST NOT send those outputs as channel replies

#### Scenario: Failed turn during stream consumption

- **WHEN** the turn stream yields `turn.failed`
- **THEN** core MUST treat the direct or mentioned processing as failed
- **AND** it MUST follow the existing error-handling requirement for direct or mentioned turns
