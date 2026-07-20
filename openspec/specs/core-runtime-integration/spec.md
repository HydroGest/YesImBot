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

Core MUST convert each eligible Koishi message into a runtime-domain `Platform.Message` whose working content is Koishi `Element[]`. After preparation and sealing, core MUST persist the new incompatible `athena.platform.message` custom runtime message as `Platform.MessageRecord` with literal `content: string`.

#### Scenario: Non-self message is admitted

- **WHEN** core receives a non-self Koishi session message and routing admits it
- **THEN** core MUST prepare and normalize elements before append or run submission
- **AND** custom message data MUST contain stable metadata and literal sealed `content` derived from `elements`
- **AND** it MUST NOT contain a duplicate `kind: "message"`, legacy message shape, snapshot, semantic view, or rendered presentation

#### Scenario: Preserve Koishi content

- **WHEN** the Koishi message content contains message element strings such as `<at/>`
- **THEN** core MUST preserve `session.content` exactly in the platform message content

#### Scenario: Self message received

- **WHEN** core receives a message authored by the bot itself
- **THEN** it MUST ignore the message by default
- **AND** it MUST NOT enqueue preparation

### Requirement: Platform Event Type Surface

Core MUST expose public `Platform.Event` types with source, primary scope, type, optional platform timestamp, typed structured data, and frozen sanitized content. `Platform.Event` MUST NOT contain core receipt metadata. Plugins MUST extend event variants through TypeScript declaration merging without Fact, EventView, or template contributions.

#### Scenario: Platform event extension

- **WHEN** a plugin adds a non-message event kind
- **THEN** it MUST extend the event variant map through declaration merging
- **AND** the resulting event type MUST expose its declared structured data

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

Core MUST provide a built-in runtime plugin that projects `athena.platform.message` through the fixed core envelope and core local-only element/image projection.

#### Scenario: Model conversion

- **WHEN** the built-in platform message plugin converts an `athena.platform.message`
- **THEN** core MUST produce a user model message with fixed formatted header and sealed content text
- **AND** it MUST NOT access platform APIs, network resources, or adapter model-projection hooks

#### Scenario: Unknown custom message

- **WHEN** the built-in platform message plugin receives another custom message type
- **THEN** it MUST leave conversion to other runtime plugins

### Requirement: Single Synchronous Adapter Refiner

Core MUST deterministically select at most one adapter for a collected Session and MAY invoke its optional synchronous `refine({ session, base })` hook before routing. Identity fields (`id`, optional `platform` / `adapter` / `profile`) MUST live flat on the adapter object without a nested identity type. The refiner MUST return a discriminated `Platform.RefineResult`: `keep`, `ignore`, `message`, or `event`. `keep` MUST retain an existing core base and otherwise act as ignore. `message` MUST replace an existing base message and is invalid without one. `event` MUST contain one complete semantic event. Core MUST NOT add separate message/event/scope/sender normalizer hooks, reader registries, or a multi-refiner pipeline.

#### Scenario: Adapter replaces a recognized message

- **WHEN** core has normalized a Session into a base `Platform.Message` and the selected adapter returns `message`
- **THEN** core MUST invoke that hook before routing
- **AND** it MUST use the returned message while preserving the base `receivedAt`

#### Scenario: Adapter returns message without a base

- **WHEN** core has no base message for a collected Session and the selected adapter returns `message`
- **THEN** core MUST record a diagnostic and ignore the invalid result
- **AND** it MUST skip adapter preparation for that Session

### Requirement: Core Receipt-Time Authority

Core MUST capture one `receivedAt` value immediately when collecting an inbound message Session and preserve it unchanged through synchronous normalization, adapter refinement, static classification, preparation, and persistence. `receivedAt` belongs to `Platform.Message` and `Platform.MessageRecord`, not `Platform.Event`. Core MUST NOT collect a second receipt timestamp for the same message.

#### Scenario: Collected Session becomes a message

- **WHEN** one collected Session is normalized as a `Platform.Message`
- **THEN** preparation and persistence MUST retain the same `receivedAt` value assigned at collection
- **AND** adapter replacement MUST NOT overwrite that value

### Requirement: Static Message-ID Tool Capability

Core MUST determine whether to include a formatted message ID from the active channel plugins' static `requiresMessageId` capability before constructing its platform projection plugin. Plugins that expose a message-operation tool MUST set this capability; plugins without such tools MUST NOT cause an ID field. This capability is not adapter-controlled and MUST NOT require model-time tool enumeration.

#### Scenario: OneBot operation tools are active

- **WHEN** an active OneBot utility plugin exposes reaction or essence operations for a channel
- **THEN** it MUST declare `requiresMessageId`
- **AND** core MUST configure that channel's projection to include raw message IDs

### Requirement: Canonical Platform Service Entry

Core MUST expose the plugin-facing platform service only through `ctx.yesimbot.platform`. Plugins MUST depend on the `yesimbot` service and use that typed property without assertions or an additional public service path.

#### Scenario: Platform plugin accesses the service

- **WHEN** a platform plugin registers or publishes through the platform service
- **THEN** it MUST use `ctx.yesimbot.platform`
- **AND** public documentation MUST describe that path as the sole platform service entry

### Requirement: FIFO Channel Message Lifecycle

For each admitted channel input, core MUST serialize static classification, message preparation, channel Agent resolution, the final runtime busy read, and the initial append/send/run submission in the per-channel FIFO. Static classification MUST produce `ignore`, `append`, or `reply` without consulting busy state. Core MUST return immediately for `ignore`. For `reply`, core MUST read `Agent.getActiveTurnId()` after preparation and immediately before submission, with no await between that read and `send(message, { ifBusy: "join" })` or `run(message)`. Model stream consumption, outbound response delivery, and terminal stream handling MUST occur outside the FIFO.

#### Scenario: Two messages arrive in one channel

- **WHEN** two eligible messages arrive for the same channel
- **THEN** core MUST complete the first message's preparation and initial submission before starting the second message's preparation
- **AND** core MUST make each reply's busy decision only after its preparation completes
- **AND** core MUST allow model turn stream consumption to proceed outside the lifecycle lock

### Requirement: Reset Is Ordered With Preparation

Core MUST enqueue reset in the same FIFO channel lifecycle as messages. Reset MUST wait for preparation and initial submission already ahead of it, then perform this strict order: `interrupt -> stop -> message storage clear -> channel asset clear -> runtime cache delete`. Messages enqueued after reset MUST not classify, prepare, resolve a runtime, or submit before reset completes.

#### Scenario: Reset follows image preparation

- **WHEN** reset is requested while a same-channel message is preparing images
- **THEN** reset MUST wait for that preparation and initial submission to finish
- **AND** reset MUST subsequently clear the resulting history and image assets before returning

#### Scenario: Message arrives after reset request

- **WHEN** an eligible message arrives after reset has been enqueued for its channel
- **THEN** core MUST not prepare or submit that message before the reset operation completes

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
