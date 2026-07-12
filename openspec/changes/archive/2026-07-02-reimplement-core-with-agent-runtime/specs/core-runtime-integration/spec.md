## ADDED Requirements

### Requirement: Core Service API
The Koishi core plugin MUST expose `ctx.yesimbot` as the main core service and MUST keep `ctx["yesimbot.model"]` as the model registry service.

#### Scenario: External plugin registers an agent plugin factory
- **WHEN** a Koishi plugin calls `ctx.yesimbot.registerAgentPlugin(factory)`
- **THEN** the core service MUST store the factory for channel runtimes created after registration
- **AND** the call MUST return a dispose function that unregisters that factory for future channel runtimes

#### Scenario: Registered factory creates one channel plugin
- **WHEN** core creates a channel runtime
- **THEN** it MUST call each registered factory with the channel agent context
- **AND** each factory MUST return exactly one `AgentPlugin`

#### Scenario: Registered factory context is narrow
- **WHEN** core calls an agent plugin factory
- **THEN** the context MUST include channel metadata and a logger
- **AND** the context MUST NOT include a full Koishi `Context` or current Koishi `Session`

#### Scenario: Runtime handles are not exposed
- **WHEN** external code uses `ctx.yesimbot`
- **THEN** the service MUST NOT expose direct `getRuntime`, `createRuntime`, `send`, or `append` operations

### Requirement: Channel Runtime Identity
Core MUST create and cache one agent runtime per `platform + selfId + channelId` key.

#### Scenario: First message in a channel
- **WHEN** core receives the first eligible message for a channel key
- **THEN** it MUST lazily create an agent runtime for that key

#### Scenario: Subsequent message in the same channel
- **WHEN** core receives another eligible message with the same platform, self id, and channel id
- **THEN** it MUST reuse the existing runtime for that key

#### Scenario: Same channel with different bot identity
- **WHEN** core receives messages with the same platform and channel id but different self ids
- **THEN** it MUST use different runtimes

#### Scenario: Channel type metadata
- **WHEN** core creates the channel runtime context
- **THEN** it MUST include whether the channel is private or group
- **AND** the channel type MUST NOT be part of the runtime key

### Requirement: Core Configuration
Core MUST keep first-version configuration limited to `basePath`, `chatModel`, and `logLevel`.

#### Scenario: Resolve unified base path
- **WHEN** `basePath` is relative
- **THEN** core MUST resolve it against Koishi `ctx.baseDir`

#### Scenario: Use absolute base path
- **WHEN** `basePath` is absolute
- **THEN** core MUST use it as-is

#### Scenario: Locate core data files
- **WHEN** core needs prompt files, model configuration, or sessions
- **THEN** it MUST resolve `AGENTS.md`, `PERSONA.md`, `models.json`, and `sessions/` under the unified base path

### Requirement: Model Resolution Boundary
Core MUST resolve the configured chat model through `ctx["yesimbot.model"]` and pass only the resolved `LanguageModel` to `agent-runtime`.

#### Scenario: Channel runtime creation
- **WHEN** core creates a channel runtime
- **THEN** it MUST resolve `config.chatModel` through the model service
- **AND** it MUST pass the resolved `LanguageModel` to `createAgent`

#### Scenario: Model configuration changes
- **WHEN** model configuration or provider registration changes after a channel runtime has been created
- **THEN** core MUST NOT hot-swap the model for that runtime in the first version

### Requirement: Channel JSONL Storage
Core MUST use one append-only JSONL storage file per channel runtime.

#### Scenario: Storage path construction
- **WHEN** core creates storage for a channel runtime
- **THEN** it MUST place the JSONL file under `basePath/sessions/`
- **AND** the filename MUST be derived from `platform`, `selfId`, and `channelId` after filtering special filename characters with `sanitize-filename`

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, migrations, or compression

#### Scenario: Restart reads history
- **WHEN** core recreates a channel runtime whose JSONL file already exists
- **THEN** the runtime storage MUST read the previously appended entries

### Requirement: Channel Message Conversion
Core MUST convert each eligible Koishi message into a stable `athena.channel.message` custom runtime message.

#### Scenario: Non-self message received
- **WHEN** core receives a Koishi session message not authored by the bot itself
- **THEN** it MUST create a channel message containing version, kind, id, timestamp, author, message id, and message content

#### Scenario: Preserve Koishi content
- **WHEN** the Koishi message content contains message element strings such as `<at/>`
- **THEN** core MUST preserve `session.content` exactly in the channel message content

#### Scenario: Self message received
- **WHEN** core receives a message authored by the bot itself
- **THEN** it MUST ignore the message by default

### Requirement: Message Routing
Core MUST append ordinary group messages and send direct or mentioned messages.

#### Scenario: Ordinary group message
- **WHEN** core receives a non-self group message that does not mention the bot
- **THEN** it MUST call `agent.append()` with the channel message
- **AND** it MUST NOT trigger a reply by itself

#### Scenario: Direct message
- **WHEN** core receives a non-self direct message
- **THEN** it MUST call `agent.send()` with the channel message
- **AND** it MUST wait for the turn result before rendering replies

#### Scenario: Group mention
- **WHEN** core receives a non-self group message that mentions the bot
- **THEN** it MUST call `agent.send()` with the channel message
- **AND** it MUST wait for the turn result before rendering replies

#### Scenario: Busy direct or mentioned message
- **WHEN** a direct or mentioned message arrives while the channel runtime has an active turn
- **THEN** core MUST send it with join behavior so it enters the active turn as explicit joined input

### Requirement: Channel Message Model Projection
Core MUST provide a built-in runtime plugin that projects `athena.channel.message` into model messages.

#### Scenario: Model conversion
- **WHEN** the built-in channel message plugin converts an `athena.channel.message`
- **THEN** it MUST produce a user model message that includes the sender display name or id and the preserved Koishi content

#### Scenario: Unknown custom messages
- **WHEN** the built-in channel message plugin receives another custom message type
- **THEN** it MUST leave conversion to other runtime plugins

### Requirement: Prompt File Injection
Core MUST inject prompt sources in the first-version prompt order.

#### Scenario: Core system prompt
- **WHEN** core builds the runtime system prompt
- **THEN** it MUST include core identity, channel context, message presentation notes, and a light plain-text output instruction

#### Scenario: AGENTS prompt message
- **WHEN** `AGENTS.md` exists under the unified base path
- **THEN** core MUST inject its content as a system message through a built-in transform plugin

#### Scenario: PERSONA prompt message
- **WHEN** `PERSONA.md` exists under the unified base path
- **THEN** core MUST inject its content as a system message through a built-in transform plugin after the `AGENTS.md` system message

#### Scenario: Prompt file missing
- **WHEN** `AGENTS.md` or `PERSONA.md` cannot be read
- **THEN** core MUST continue with the available prompt content and log the condition

#### Scenario: Transform pipeline side effect
- **WHEN** prompt file content is injected through `transformMessages`
- **THEN** those injected system messages MUST be treated as part of the transform pipeline in the first version
- **AND** core MUST NOT provide a separate prompt preamble API in this change

### Requirement: Plugin Ordering
Core MUST inject built-in runtime plugins before externally registered runtime plugins.

#### Scenario: Runtime plugin list creation
- **WHEN** core creates a channel runtime
- **THEN** it MUST place built-in core runtime plugins before plugins returned by registered factories

#### Scenario: External plugin order
- **WHEN** multiple external factories are registered
- **THEN** core MUST call them in registration order for newly created channel runtimes

### Requirement: Assistant Reply Rendering
Core MUST send all non-empty assistant text messages produced by a direct or mentioned message turn.

#### Scenario: Multiple assistant texts
- **WHEN** a turn result contains multiple assistant messages with non-empty text content
- **THEN** core MUST send each text message to the Koishi channel in generation order

#### Scenario: Empty or non-assistant output
- **WHEN** a turn result contains empty assistant text, tool messages, or non-text content
- **THEN** core MUST NOT send those outputs as channel replies

### Requirement: Channel Reset
Core MUST support current-channel reset through the `ctx.yesimbot.resetChannel(target)` service API and a minimal Koishi command.

#### Scenario: Reset target
- **WHEN** reset is requested
- **THEN** the target MUST identify platform, self id, and channel id

#### Scenario: Reset operation
- **WHEN** core resets a channel with an existing runtime
- **THEN** it MUST interrupt the runtime, stop it, clear the channel JSONL storage, and remove it from the runtime cache

#### Scenario: Reset without existing runtime
- **WHEN** core resets a channel that has no cached runtime
- **THEN** it MUST clear that channel's JSONL storage if present

#### Scenario: Command scope
- **WHEN** a user runs the reset command
- **THEN** the command MUST reset only the current Koishi channel
- **AND** it MUST NOT accept a target for another channel in the first version

#### Scenario: Command authority
- **WHEN** a user without administrator authority runs the reset command
- **THEN** Koishi command authorization MUST prevent the reset

### Requirement: Error Handling and Diagnostics
Core MUST keep first-version user-visible errors minimal and log detailed diagnostics.

#### Scenario: Direct or mentioned turn failure
- **WHEN** direct or mentioned message processing fails
- **THEN** core MUST log the failure
- **AND** it MAY send a generic development-time error message to the current channel

#### Scenario: Ordinary append failure
- **WHEN** ordinary group message append fails
- **THEN** core MUST log the failure
- **AND** it MUST NOT send a proactive channel reply

#### Scenario: Runtime diagnostics
- **WHEN** runtime events, tool events, plugin errors, or provider errors occur
- **THEN** core MUST route detailed information to the logger according to `logLevel`
- **AND** it MUST NOT expose hidden chain-of-thought as a logged or sent artifact

### Requirement: Runtime Disposal
Core MUST interrupt and stop known channel runtimes during Koishi disposal.

#### Scenario: Koishi dispose
- **WHEN** Koishi disposes the core plugin
- **THEN** core MUST iterate over cached channel runtimes
- **AND** it MUST attempt to interrupt and stop each runtime
- **AND** it MUST clear the runtime cache
