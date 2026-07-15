## MODIFIED Requirements

### Requirement: Platform Message Conversion

Core MUST obtain each eligible Koishi message from the common validated platform
input boundary and convert it into a stable `athena.platform.message` custom
runtime message. Core MUST NOT independently convert the same Session in
middleware. The platform message MUST retain the stable message source,
author/entity snapshot, Satori message content, source occurrence time when
available, core receipt time, and any configured resource snapshots. Core MUST
freeze model-visible resource results before submitting the message to
`agent.append()`, `agent.send()`, or `agent.run()`.

#### Scenario: Non-self message received

- **WHEN** core receives a validated non-self message from the common platform
  input boundary
- **THEN** it MUST create a platform message whose top-level runtime message
  contains id and timestamp
- **AND** the platform message data MUST contain its stable source, author
  reference, message content, receipt metadata, and frozen resource snapshots
  when configured

#### Scenario: Preserve Koishi content

- **WHEN** the validated message content contains Satori element strings such as
  `<at/>` or media elements
- **THEN** core MUST preserve the Satori content as the message-content source of
  truth

#### Scenario: Self message received

- **WHEN** a validated message is authored by the current bot itself
- **THEN** core MUST ignore the message by default

### Requirement: Platform Event Type Surface

Core MUST expose `Platform.Message`, `Platform.Event`, `Platform.Scope`,
`Platform.Adapter`, `Platform.MessageView`, `Platform.EventView`, and
`Platform.Reader` for standardized input, platform extension, resource reading,
and model-view contracts. Core MUST own the common versioned fields, source,
primary scope, time, and entity-reference structures. A plugin MUST extend event
payloads or extensions through namespaced declaration merging and a registered
runtime schema; it MUST NOT add arbitrary top-level fields to all events.

#### Scenario: Platform message type

- **WHEN** a plugin imports platform types from core
- **THEN** `Platform.Message` MUST describe user message facts with stable source,
  primary scope, author reference, and Satori content

#### Scenario: Platform event extension

- **WHEN** a plugin needs to add a non-message platform event type
- **THEN** it MUST declare a namespaced payload type
- **AND** it MUST register a matching runtime schema before core accepts event
  data for that type

### Requirement: Message Routing

Core MUST append ordinary group messages and process direct or mentioned
messages through the channel runtime using the platform message from the common
input boundary. Core MUST preserve existing self-message ignore, ordinary group
observation, direct-message turn, group-mention turn, and busy-join behavior.

#### Scenario: Ordinary group message

- **WHEN** a non-self validated group message does not mention the bot
- **THEN** core MUST call `agent.append()` with the platform message
- **AND** it MUST NOT trigger a reply by itself

#### Scenario: Direct message

- **WHEN** a non-self validated direct message arrives
- **THEN** core MUST process the platform message through `agent.run()`
- **AND** it MUST consume the returned turn-scoped stream before rendering
  replies

#### Scenario: Group mention

- **WHEN** a non-self validated group message mentions the bot
- **THEN** core MUST process the platform message through `agent.run()`
- **AND** it MUST consume the returned turn-scoped stream before rendering
  replies

#### Scenario: Busy direct or mentioned message

- **WHEN** a direct or mentioned message arrives while the channel runtime has
  an active turn
- **THEN** core MUST send it with join behavior so it enters the active turn as
  explicit joined input

#### Scenario: One Session reaches middleware

- **WHEN** a Session first creates a platform message at the common input
  boundary and later reaches middleware
- **THEN** core MUST route the existing platform message
- **AND** core MUST NOT append, send, or persist a duplicate message

### Requirement: Platform Message Model Projection

Core MUST provide a built-in runtime plugin that projects platform messages and
channel-admitted platform events through the unified core presentation path.
The plugin MUST render model-visible content from stable Satori content or
stored semantic nodes. It MUST NOT require a platform-specific runtime plugin to
render historical admitted events and MUST NOT perform resource I/O during
`toModelMessages`.

#### Scenario: Model conversion

- **WHEN** the built-in plugin converts an `athena.platform.message`
- **THEN** it MUST produce user model content that includes the sender display
  name or id and the unified presentation of preserved Satori content

#### Scenario: Historical custom event conversion

- **WHEN** channel history contains an admitted platform event represented by
  stored semantic nodes
- **THEN** the built-in plugin MUST render those nodes without requiring the
  original platform adapter plugin

#### Scenario: Unknown custom messages

- **WHEN** the built-in platform presentation plugin receives another custom
  runtime message type
- **THEN** it MUST leave conversion to other runtime plugins
