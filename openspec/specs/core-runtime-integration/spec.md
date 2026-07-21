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

### Requirement: Channel Runtime Ownership

Core MUST place channel message classification, preparation order, Agent creation and caching, append/join/run submission, turn stream consumption, output projection, reset, and stop behind one channel runtime module. The module MUST expose message handling, channel reset, and runtime stop operations without exposing Agent handles, turn streams, or individual orchestration steps to `YesImBotService` or external plugins.

#### Scenario: Core service handles an admitted message

- **WHEN** `YesImBotService` receives a Session with a collected platform message
- **THEN** it MUST delegate the message and original Session to the channel runtime
- **AND** it MUST NOT manually compose classification, preparation, Agent submission, stream consumption, or delivery

#### Scenario: Session is an operational dependency

- **WHEN** the channel runtime handles a platform message
- **THEN** it MAY pass the original Session to platform preparation and passive delivery
- **AND** it MUST NOT read routing facts from the Session, serialize it, cache it beyond the active handle, or pass it into `agent-runtime`

#### Scenario: One run owns one stream

- **WHEN** an idle channel starts a turn with `Agent.run()`
- **THEN** the channel runtime MUST own exactly one consumer for the returned stream
- **AND** messages joined to that active turn MUST NOT create another stream consumer

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

Core MUST keep first-version configuration limited to `basePath`, `chatModel`, `logLevel`, platform profiles, and deterministic message routing. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `append` or `reply`. Defaults MUST preserve direct reply, group-mention reply, and ordinary-group append. Self-message ignore MUST NOT be configurable.

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

#### Scenario: Use default routing

- **WHEN** the user does not override message routing
- **THEN** direct and mentioned messages MUST map to `reply`
- **AND** ordinary group messages MUST map to `append`

#### Scenario: Override one routing scenario

- **WHEN** the user configures one scenario as `append` or `reply`
- **THEN** core MUST apply that action to the scenario without changing FIFO, preparation, busy-read, or submission ordering

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

Core MUST classify each admitted message from canonical `Platform.Message` data and the deterministic routing configuration. Core MUST derive self-message status from normalized sender and source identities, mention status from normalized elements, and directness from the canonical channel type. It MUST produce only `ignore`, `append`, or `reply` and MUST NOT consult runtime busy state during classification.

#### Scenario: Self message

- **WHEN** the canonical sender ID equals the canonical source self ID
- **THEN** core MUST classify the message as `ignore`
- **AND** it MUST NOT prepare, persist, or submit that message

#### Scenario: Scenario configured as append

- **WHEN** a non-self message belongs to a scenario configured as `append`
- **THEN** core MUST prepare the platform message and call `Agent.append()`
- **AND** it MUST NOT trigger a reply by itself

#### Scenario: Scenario configured as reply while idle

- **WHEN** a non-self message belongs to a scenario configured as `reply` and the channel has no active turn after preparation
- **THEN** core MUST process the platform message through `Agent.run()`
- **AND** the channel runtime MUST consume the returned turn stream

#### Scenario: Scenario configured as reply while busy

- **WHEN** a non-self message belongs to a scenario configured as `reply` and the channel has an active turn after preparation
- **THEN** core MUST call `Agent.send(message, { ifBusy: "join" })`
- **AND** the joined input MUST use the existing turn's stream owner

#### Scenario: Adapter refines canonical message facts

- **WHEN** the selected adapter returns a refined platform message during collection
- **THEN** runtime identity, Agent context, sender checks, mention checks, and persistence MUST use the refined message
- **AND** core MUST NOT restore conflicting values from the raw Session

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

For each admitted channel input, the channel runtime MUST serialize static classification, message preparation, channel Agent resolution, the final runtime busy read, and the initial append/send/run submission in the per-channel FIFO. Static classification MUST produce `ignore`, `append`, or `reply` without consulting busy state. The runtime MUST return immediately for `ignore`. For `reply`, it MUST read `Agent.getActiveTurnId()` after preparation and immediately before submission, with no await between that read and `send(message, { ifBusy: "join" })` or `run(message)`. Model stream consumption, output projection, delivery, and terminal stream handling MUST occur outside the FIFO.

#### Scenario: Two messages arrive in one channel

- **WHEN** two eligible messages arrive for the same channel
- **THEN** core MUST complete the first message's preparation and initial submission before starting the second message's preparation
- **AND** core MUST make each reply's busy decision only after its preparation completes
- **AND** core MUST allow model turn stream consumption and delivery to proceed outside the lifecycle lock

#### Scenario: Messages arrive in different channels

- **WHEN** eligible messages arrive for different channel scope IDs
- **THEN** one channel's lifecycle FIFO MUST NOT serialize the other channel's preparation or initial submission

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

Core MUST collect all non-empty assistant text messages produced by a reply turn, project them into ordered Koishi fragments, and submit them to DeliveryService through the original Session. The channel runtime MUST own stream consumption and MUST NOT call `session.send()` directly.

#### Scenario: Multiple assistant texts from run stream

- **WHEN** a reply turn emits one or more turn-scoped `message.appended` events whose message role is `assistant` and text is non-empty
- **THEN** core MUST preserve generation order when projecting those messages
- **AND** it MUST submit the ordered outputs to passive delivery exactly once for that turn

#### Scenario: Empty or non-assistant output

- **WHEN** the turn stream contains empty assistant text, tool messages, or non-text content only
- **THEN** core MUST NOT submit those outputs as channel replies

#### Scenario: Failed turn during stream consumption

- **WHEN** the turn stream yields `turn.failed`
- **THEN** the channel runtime MUST treat the reply processing as failed
- **AND** it MUST follow the error-handling requirement for reply turns

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

Core MUST keep first-version user-visible errors minimal, log channel processing failures, and route any user-visible error output through DeliveryService. Delivery failure MUST NOT roll back an Agent or storage operation that already completed.

#### Scenario: Reply turn failure

- **WHEN** a message classified as `reply` fails during preparation, Agent submission, or stream consumption
- **THEN** core MUST log the failure
- **AND** it MAY ask DeliveryService to send one generic development-time error message through the original Session

#### Scenario: Ordinary append failure

- **WHEN** a message classified as `append` fails
- **THEN** core MUST log the failure
- **AND** it MUST NOT send a proactive channel reply

#### Scenario: Error reply delivery fails

- **WHEN** delivery of the generic error output fails
- **THEN** core MUST log the delivery failure
- **AND** it MUST NOT attempt another user-visible error delivery

### Requirement: Runtime Disposal

Core MUST stop accepting new channel runtime operations, interrupt and stop known channel Agents, wait for owned turn stream consumers to terminate, and clear the runtime cache during Koishi disposal. Disposal MUST NOT clear persisted channel history or assets.

#### Scenario: Koishi dispose

- **WHEN** Koishi disposes the core plugin
- **THEN** the channel runtime MUST reject new handle and reset operations
- **AND** it MUST attempt to interrupt and stop each cached Agent
- **AND** it MUST wait for owned stream consumers to terminate and clear the runtime cache

#### Scenario: Persisted data during disposal

- **WHEN** runtime disposal completes
- **THEN** core MUST preserve channel JSONL history and channel assets

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
