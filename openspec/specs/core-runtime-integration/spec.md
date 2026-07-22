# core-runtime-integration Specification

## Purpose

Define how `koishi-plugin-yesimbot` integrates Koishi with `@yesimbot/agent-runtime`, including the runtime manager, channel runtime lifecycle, Will evaluation, JSONL storage, prompt injection, reset, stop ordering, and error isolation.

## Requirements

### Requirement: Core Runtime Facade
`YesImBotService` MUST remain a thin Koishi composition facade in top-level `service.ts`. It MUST expose SessionResolver, `Will.Factory`, and Agent plugin registration plus channel reset, and MUST delegate Session handling and runtime lifecycle to internal modules.

#### Scenario: Platform plugin registers a resolver
- **WHEN** a plugin calls `ctx.yesimbot.registerResolver()`
- **THEN** the facade MUST delegate registration to Gateway

#### Scenario: Plugin registers a Will factory
- **WHEN** a plugin calls `ctx.yesimbot.registerWill()`
- **THEN** the facade MUST delegate the active factory to RuntimeManager

### Requirement: Runtime Manager Ownership
RuntimeManager MUST own the map from canonical ChannelScope to ChannelRuntime, concurrent get-or-create behavior, channel reset, `Will.Factory` replacement, and global stop. It MUST NOT accept Session, call SessionResolver, send platform messages, or serve as an event broadcast bus.

#### Scenario: First event reaches a channel
- **WHEN** RuntimeManager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the canonical channel key

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** RuntimeManager MUST create one ChannelRuntime and route every event to it

### Requirement: Single Channel Runtime Ownership
Each ChannelRuntime MUST represent exactly one channel and MUST own that channel's FIFO, Agent, JSONL storage, Will instance, local state, model projection, and Agent-internal stream consumption. Its canonical identity MUST be an injective scope tuple; its JSONL and scoped-asset paths MUST be domain-separated SHA-256/base64url v2 names that disclose no raw scope component.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable channel identity

### Requirement: FIFO Event Lifecycle
ChannelRuntime MUST serialize accepted EventRecords through one channel FIFO for Event creation, persistence, committed-event observation, and Will decision. It MUST persist Event before calling Will.

#### Scenario: Accepted event enters a channel
- **WHEN** RuntimeManager routes a resolved event to ChannelRuntime
- **THEN** ChannelRuntime MUST append its Event
- **AND** it MUST emit `yesimbot/event`
- **AND** it MUST then evaluate Will and emit `yesimbot/will`

### Requirement: Message-Level Outbound Ownership
When Will triggers an idle Agent, ChannelRuntime MUST own the sole consumer of the Agent internal stream and MUST expose only complete renderable assistant messages as `AsyncIterable<ChannelRuntime.Output>`. It MUST NOT expose token deltas, tool events, or raw Agent internal events to Gateway.

#### Scenario: Assistant message is appended
- **WHEN** the Agent appends a complete assistant message with renderable content
- **THEN** ChannelRuntime MUST yield one ChannelRuntime.Output without waiting for turn completion

#### Scenario: Turn emits internal events
- **WHEN** the Agent emits tool, plugin, delta, or lifecycle events
- **THEN** ChannelRuntime MUST consume them internally and MUST NOT yield them to Gateway

### Requirement: Busy Turn Join Ownership
When Will triggers while the channel Agent is busy, ChannelRuntime MUST join the committed Event to the active turn and MUST NOT create another Agent internal stream consumer or output iterable.

#### Scenario: Busy channel receives a trigger
- **WHEN** Will returns `trigger` and an active turn exists
- **THEN** ChannelRuntime MUST join the record to that turn
- **AND** the Gateway for the joined event MUST receive no outbound iterable

### Requirement: Default Will Routing Configuration
First-version routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`. Defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no routing override is configured
- **THEN** DefaultWill MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

### Requirement: Channel Runtime Reset
RuntimeManager MUST reset one channel in this order: interrupt Agent, stop Agent, stop Will, wait channel work, clear JSONL, clear scoped assets, and remove the ChannelRuntime. JSONL and asset cleanup MUST be independently attempted in that order; a cleanup error MUST be reported only after later mandatory cleanup and cache deletion complete. Reset MUST also independently clear persisted channel data when no runtime is cached.

#### Scenario: Cached channel is reset
- **WHEN** reset targets an active channel
- **THEN** RuntimeManager MUST follow the required teardown and clearing order

#### Scenario: Uncached channel is reset
- **WHEN** reset targets a channel without a cached runtime
- **THEN** RuntimeManager MUST clear that channel's JSONL and scoped assets if present

### Requirement: Runtime Stop Ordering
Global stop MUST stop Gateway admission, stop RuntimeManager admission, interrupt and stop all ChannelRuntime Agent and Will instances, terminate output iterables, wait active Gateway handlers, and release in-memory runtimes. Global stop MUST preserve JSONL history and assets.

#### Scenario: Core is disposed during an active turn
- **WHEN** global stop begins while a channel turn is active
- **THEN** core MUST prevent new admission and terminate the active runtime work
- **AND** it MUST wait for the owning Gateway handler to finish

### Requirement: Runtime Error Isolation
Resolver, persistence, Will, Agent, observation listener, projection, and delivery failures MUST retain their distinct diagnostics and MUST NOT be mislabeled as one another. A failure in one channel MUST NOT stop another channel runtime.

#### Scenario: Will observer throws
- **WHEN** a `yesimbot/will` listener throws
- **THEN** core MUST record a listener diagnostic
- **AND** it MUST preserve and execute the Will decision

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
Core MUST use one append-only JSONL storage file per channel runtime under domain-separated opaque path derived from the canonical channel identity.

#### Scenario: Storage path construction
- **WHEN** core creates storage for a channel runtime
- **THEN** it MUST derive a SHA-256/base64url v2 path from the immutable channel scope tuple
- **AND** it MUST NOT derive the path from sanitized raw platform fields

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, migrations, or compression

#### Scenario: Restart reads history
- **WHEN** core recreates a channel runtime whose canonical JSONL file already exists
- **THEN** the runtime storage MUST read the previously appended entries

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
