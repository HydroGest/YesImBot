# core-runtime-integration Specification

## Purpose

Define how `koishi-plugin-yesimbot` integrates Koishi with `@yesimbot/agent-runtime`, including the core service API, channel runtime lifecycle, JSONL storage, prompt injection, message routing, reset, error handling, and disposal behavior.
## Requirements
### Requirement: Core Service API

The Koishi core plugin MUST expose `ctx.yesimbot` as the main core service and MUST keep `ctx["yesimbot.model"]` as the model registry service.

#### Scenario: External plugin registers an agent plugin factory

- **WHEN** a Koishi plugin calls `ctx.yesimbot.registerAgentPlugin(factory)`
- **THEN** the core service MUST store the factory for channel runtimes created after registration
- **AND** the call MUST return a dispose function that unregisters that factory for future channel runtimes

#### Scenario: External plugin republishes a factory

- **WHEN** a Koishi plugin disposes a previously registered factory and registers a replacement factory
- **THEN** future channel runtimes MUST use the replacement factory
- **AND** already-created channel runtimes MUST NOT be hot-swapped by core in the first version

#### Scenario: Registered factory creates one channel plugin

- **WHEN** core creates a channel runtime
- **THEN** it MUST call each registered factory with the channel agent context
- **AND** each factory MUST return exactly one `AgentPlugin`

#### Scenario: Registered factory context is narrow

- **WHEN** core calls an agent plugin factory
- **THEN** the context MUST include channel metadata
- **AND** the context MUST include a platform section with platform name
- **AND** the context MAY include a raw Koishi bot handle as `platform.unsafeBot`
- **AND** the context MUST NOT include a full Koishi `Context` or current Koishi `Session`

#### Scenario: Unsafe bot handle is captured from channel creation

- **WHEN** core creates a channel runtime from an eligible Koishi session
- **THEN** `platform.unsafeBot` MUST reference the raw Koishi bot associated with that session when one is available
- **AND** existing channel runtimes MUST NOT hot-swap `platform.unsafeBot` if the underlying Koishi bot changes later

#### Scenario: Platform capabilities remain outside agent-runtime

- **WHEN** a plugin needs adapter-specific APIs such as OneBot `bot.internal`
- **THEN** the plugin MUST access them through the channel agent context and plugin-owned closures
- **AND** `agent-runtime` MUST NOT expose Koishi `Context`, Koishi `Session`, Koishi `Bot`, or adapter-specific internals through `AgentToolExecuteContext` or hook contexts

#### Scenario: Runtime handles are not exposed

- **WHEN** external code uses `ctx.yesimbot`
- **THEN** the service MUST NOT expose direct `getRuntime`, `createRuntime`, `send`, or `append` operations

### Requirement: Channel Runtime Identity

Core MUST create and cache one agent runtime per `ChannelScopeId` derived from the current `ChannelScope`.

#### Scenario: First message in a channel
- **WHEN** core receives the first eligible message for a channel scope
- **THEN** it MUST derive a `ChannelScopeId`
- **AND** it MUST lazily create an agent runtime for that id

#### Scenario: Subsequent message in the same channel
- **WHEN** core receives another eligible message with the same platform, self id, and channel id
- **THEN** it MUST derive the same `ChannelScopeId`
- **AND** it MUST reuse the existing runtime for that id

#### Scenario: Same channel with different bot identity
- **WHEN** core receives messages with the same platform and channel id but different self ids
- **THEN** it MUST derive different `ChannelScopeId` values
- **AND** it MUST use different runtimes

#### Scenario: Channel type metadata
- **WHEN** core creates the channel runtime context
- **THEN** it MUST include whether the channel is private or group
- **AND** the channel type MUST NOT be part of the `ChannelScopeId`

### Requirement: Core Configuration

Core MUST keep first-version configuration limited to `basePath`, `chatModel`, and `logLevel`.

#### Scenario: Resolve unified base path
- **WHEN** `basePath` is relative
- **THEN** core MUST resolve it against Koishi `ctx.baseDir`

#### Scenario: Use absolute base path
- **WHEN** `basePath` is absolute
- **THEN** core MUST use it as-is

#### Scenario: Locate core data files
- **WHEN** core needs prompt files, model configuration, channel metadata, or sessions
- **THEN** it MUST resolve `AGENTS.md`, `PERSONA.md`, and `models.json` under the unified base path
- **AND** it MUST resolve channel metadata and session files under `channels/<ChannelScopeId>/`

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

Core MUST use one append-only JSONL storage file per channel runtime under that channel's canonical directory.

#### Scenario: Storage path construction
- **WHEN** core creates storage for a channel runtime
- **THEN** it MUST derive the `ChannelScopeId` from the current `ChannelScope`
- **AND** it MUST place the JSONL file at `basePath/channels/<ChannelScopeId>/sessions/messages.jsonl`
- **AND** it MUST NOT derive the filename from sanitized raw platform fields

#### Scenario: Scope metadata is ensured before storage use
- **WHEN** core creates channel storage
- **THEN** it MUST ensure the channel scope metadata record exists for the derived `ChannelScopeId`

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, migrations, or compression

#### Scenario: Restart reads history
- **WHEN** core recreates a channel runtime whose canonical JSONL file already exists
- **THEN** the runtime storage MUST read the previously appended entries

### Requirement: Platform Message Conversion

Core MUST convert each eligible Koishi message into a stable `athena.platform.message` custom runtime message.

#### Scenario: Non-self message received

- **WHEN** core receives a Koishi session message not authored by the bot itself
- **THEN** it MUST create a platform message whose top-level runtime message contains id and timestamp
- **AND** the platform message data MUST contain version, source, author, and message content
- **AND** the platform message data MUST NOT repeat `kind: "message"` because the custom message type already identifies message events

#### Scenario: Preserve Koishi content

- **WHEN** the Koishi message content contains message element strings such as `<at/>`
- **THEN** core MUST preserve `session.content` exactly in the platform message content

#### Scenario: Self message received

- **WHEN** core receives a message authored by the bot itself
- **THEN** it MUST ignore the message by default

### Requirement: Platform Event Type Surface

Core MUST expose platform-facing public types for platform messages and non-message platform events.

#### Scenario: Platform message type

- **WHEN** a plugin imports platform types from core
- **THEN** `PlatformMessage` MUST describe user message events with source, author, and message content

#### Scenario: Platform event extension

- **WHEN** a plugin needs to add a non-message platform event kind
- **THEN** it MUST extend `PlatformEventVariants` through TypeScript declaration merging
- **AND** the resulting `PlatformEvent` MUST include version, kind, source, author, and optional operator

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

### Requirement: Platform Message Model Projection

Core MUST provide a built-in runtime plugin that projects `athena.platform.message` into model messages.

#### Scenario: Model conversion

- **WHEN** the built-in platform message plugin converts an `athena.platform.message`
- **THEN** it MUST produce a user model message that includes the sender display name or id and the preserved Koishi content

#### Scenario: Unknown custom messages

- **WHEN** the built-in platform message plugin receives another custom message type
- **THEN** it MUST leave conversion to other runtime plugins

### Requirement: Prompt File Injection

Core MUST inject prompt sources in the first-version prompt order.

#### Scenario: Core system prompt

- **WHEN** core builds the runtime system prompt
- **THEN** it MUST include core identity, channel context, message presentation notes, and a light plain-text output instruction

#### Scenario: AGENTS prompt extension

- **WHEN** `AGENTS.md` exists under the unified base path
- **THEN** core MUST append its content to the runtime system input through a built-in structured system prompt append plugin

#### Scenario: PERSONA prompt extension

- **WHEN** `PERSONA.md` exists under the unified base path
- **THEN** core MUST append its content to the runtime system input through the same built-in structured system prompt append plugin after the `AGENTS.md` content

#### Scenario: Prompt file missing

- **WHEN** `AGENTS.md` or `PERSONA.md` cannot be read
- **THEN** core MUST continue with the available prompt content and log the condition

#### Scenario: Prompt extension stays in system prompt

- **WHEN** prompt file content is injected
- **THEN** those prompt files MUST remain part of the runtime system input sent through AI SDK's `system` option
- **AND** core MUST NOT duplicate the same content through `transformMessages`

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

### Requirement: Channel Reset

Core MUST support current-channel reset through the `ctx.yesimbot.resetChannel(scope)` service API and a minimal Koishi command.

#### Scenario: Reset scope
- **WHEN** reset is requested
- **THEN** the scope MUST identify platform, self id, and channel id as a `ChannelScope`

#### Scenario: Reset operation
- **WHEN** core resets a channel with an existing runtime
- **THEN** it MUST interrupt the runtime, stop it, clear the channel JSONL storage, and remove it from the runtime cache

#### Scenario: Reset without existing runtime
- **WHEN** core resets a channel that has no cached runtime
- **THEN** it MUST clear that channel's JSONL storage if present under the canonical channel directory

#### Scenario: Command scope
- **WHEN** a user runs the reset command
- **THEN** the command MUST reset only the current Koishi channel
- **AND** it MUST NOT accept a scope for another channel in the first version

#### Scenario: Command authority
- **WHEN** a user without administrator authority runs the reset command
- **THEN** Koishi command authorization MUST prevent the reset

### Requirement: Error Handling

Core MUST keep first-version user-visible errors minimal and log session processing failures.

#### Scenario: Direct or mentioned turn failure

- **WHEN** direct or mentioned message processing fails
- **THEN** core MUST log the failure
- **AND** it MAY send a generic development-time error message to the current channel

#### Scenario: Ordinary append failure

- **WHEN** ordinary group message append fails
- **THEN** core MUST log the failure
- **AND** it MUST NOT send a proactive channel reply

### Requirement: Runtime Disposal

Core MUST interrupt and stop known channel runtimes during Koishi disposal.

#### Scenario: Koishi dispose

- **WHEN** Koishi disposes the core plugin
- **THEN** core MUST iterate over cached channel runtimes
- **AND** it MUST attempt to interrupt and stop each runtime
- **AND** it MUST clear the runtime cache

### Requirement: Default Runtime Terminal Tool Enablement

Core MUST enable the agent-runtime built-in terminal tool by default when creating yesimbot channel runtimes.

#### Scenario: Channel runtime enables finalize response

- **WHEN** core creates an Agent runtime for a channel
- **THEN** it MUST enable terminal tool support in the Agent configuration
- **AND** it MUST use `finalize_response` as the default terminal tool name

#### Scenario: Terminal tool does not replace assistant rendering

- **WHEN** a turn produces assistant text and then calls `finalize_response`
- **THEN** core MUST continue to render non-empty assistant text messages through the existing assistant text rendering path
- **AND** it MUST NOT render the terminal tool result as user-visible chat text

#### Scenario: Terminal tool supports post-text tool calls

- **WHEN** a model response contains assistant text, additional tool calls, and `finalize_response`
- **THEN** core MUST wait for the turn result as usual
- **AND** it MUST send the assistant text after the turn settles
- **AND** it MUST NOT require an additional model generation after `finalize_response`
