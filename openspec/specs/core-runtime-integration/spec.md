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
RuntimeManager MUST own the map from `channelIdentity` to ChannelRuntime, concurrent get-or-create behavior, channel reset, `Will.Factory` replacement, and global stop. It MUST NOT accept Session, call SessionResolver, send platform messages, or serve as an event broadcast bus.

#### Scenario: First event reaches a channel
- **WHEN** RuntimeManager routes the first resolved event for a channel
- **THEN** it MUST create exactly one ChannelRuntime for the channel identity

#### Scenario: Concurrent events reach an uncached channel
- **WHEN** multiple events concurrently require the same new channel
- **THEN** RuntimeManager MUST create one ChannelRuntime and route every event to it

### Requirement: Online Assignee Handover

RuntimeManager MUST replace a cached shared-channel Runtime when Koishi Database changes the assignee, while preserving `channelIdentity` and persisted data.

#### Scenario: Cached Runtime belongs to old assignee
- **WHEN** a shared event passes admission for a `selfId` that differs from the cached Runtime Entry
- **THEN** RuntimeManager MUST mark the old generation as draining inside the per-identity lifecycle coordinator
- **AND** it MUST prevent that Runtime from accepting new platform events
- **AND** it MUST release the lifecycle coordinator before awaiting completion

#### Scenario: Old generation drains
- **WHEN** a Runtime generation is draining
- **THEN** Core MUST wait for Agent idle, model stream completion, Gateway delivery leases, and that generation's internal delivery-failure completion lane
- **AND** graceful stop MUST NOT interrupt a normally progressing turn

#### Scenario: New assignee Runtime is created
- **WHEN** the old generation has drained and stopped
- **THEN** RuntimeManager MUST re-enter the lifecycle coordinator and verify the generation
- **AND** it MUST query the latest database assignee again
- **AND** it MUST create a Runtime with the new Bot, Scope, Will, and plugins only if the waiting event still matches the assignee
- **AND** it MUST reuse the same Channel JSONL, Asset, and Workspace roots

### Requirement: Handover Backpressure

RuntimeManager MUST bound events waiting for one shared-channel handover and MUST fail closed when handover cannot complete.

#### Scenario: Handover queue reaches its limit
- **WHEN** five events are already waiting for one channel identity handover
- **THEN** Core MUST reject additional events explicitly
- **AND** it MUST NOT create another Runtime or retain an unbounded queue

#### Scenario: Assignee changes again during handover
- **WHEN** a waiting event reaches submission after the assignee changes again
- **THEN** Core MUST reject that stale event

#### Scenario: Drain is stuck or fails
- **WHEN** graceful drain does not complete or reports an error
- **THEN** RuntimeManager MUST remain fail closed
- **AND** it MUST NOT start a replacement Runtime until explicit stop or restart recovery

### Requirement: Single Channel Runtime Ownership
Each ChannelRuntime MUST represent exactly one Core `channelIdentity` and MUST own that channel's FIFO, Agent, JSONL storage, Will instance, local state, model projection, and Agent-internal stream consumption. Shared scopes with different `selfId` values MUST use the same identity but MUST NOT own concurrent Runtime instances. Direct scopes with different `selfId` values MUST use different identities.

#### Scenario: Channel runtime is inspected
- **WHEN** a ChannelRuntime handles an event
- **THEN** it MUST NOT contain a map of other channel runtimes
- **AND** it MUST use only its immutable identity and bound execution Scope

#### Scenario: Shared assignee changes
- **WHEN** RuntimeManager admits a different `selfId` for an existing shared identity
- **THEN** it MUST perform online assignee handover instead of creating a concurrent Runtime

### Requirement: FIFO Input Lifecycle
ChannelRuntime MUST serialize accepted `MessageRecord | EventRecord` values through one channel FIFO for Input creation, persistence, committed-input observation, and Will decision. It MUST persist Input before calling Will.

#### Scenario: Accepted event enters a channel
- **WHEN** RuntimeManager routes a resolved input record to ChannelRuntime
- **THEN** ChannelRuntime MUST append its Message or Event
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
When Will triggers while the channel Agent is busy, ChannelRuntime MUST join the committed Input to the active turn and MUST NOT create another Agent internal stream consumer or output iterable.

#### Scenario: Busy channel receives a trigger
- **WHEN** Will returns `trigger` and an active turn exists
- **THEN** ChannelRuntime MUST join the record to that turn
- **AND** the Gateway for the joined event MUST receive no outbound iterable

### Requirement: Default Will Routing Configuration
Core Will configuration MUST select `routing` or `willingness`, defaulting to `routing`. Routing configuration MUST map direct messages, group mentions, and ordinary group messages independently to `wait` or `trigger`; its defaults MUST trigger direct and mentioned messages and wait for ordinary group messages. Willingness configuration MUST use static values snapshotted by the ChannelRuntime. Self-message admission MUST remain non-configurable.

#### Scenario: Default routing is used
- **WHEN** no engine or routing override is configured
- **THEN** the routing Will MUST trigger direct and mentioned messages
- **AND** it MUST wait for ordinary group messages

#### Scenario: Willingness engine is selected
- **WHEN** configuration explicitly selects `willingness`
- **THEN** RuntimeManager MUST construct the temporary static willingness engine for future ChannelRuntimes

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
Core MUST resolve the configured chat model through `ctx["yesimbot.model"]`, pass only the resolved `LanguageModel` to agent-runtime, and derive the model entry's resolved image-input capability for the owning ChannelRuntime's immutable media snapshot.

#### Scenario: Channel runtime creation
- **WHEN** core creates a channel runtime
- **THEN** it MUST resolve `config.chatModel` through the model service
- **AND** it MUST pass the resolved `LanguageModel` to `createAgent`
- **AND** it MUST pass only the derived image-input capability and media policy to Core projection ownership

#### Scenario: Model configuration changes
- **WHEN** model configuration or provider registration changes after a channel runtime has been created
- **THEN** core MUST NOT hot-swap the model or media capability for that runtime

### Requirement: Channel JSONL Storage
Core MUST use one append-only JSONL storage file per channel identity at the path returned by Manifest-backed channel storage: `<basePath>/channels/<directoryName>/sessions/messages.jsonl`.

#### Scenario: Storage path construction
- **WHEN** Core creates storage for a ChannelRuntime
- **THEN** it MUST obtain the `sessions/messages.jsonl` path through the Core channel storage protocol
- **AND** it MUST NOT derive, sanitize, hash, or append raw platform coordinates locally

#### Scenario: Storage contract
- **WHEN** agent-runtime calls the channel storage
- **THEN** the storage MUST support `append`, `read`, and `clear`
- **AND** the storage MUST NOT require indexes, pagination, compression, or legacy conversion

#### Scenario: Restart reads history
- **WHEN** Core recreates a ChannelRuntime whose current Manifest-backed JSONL file already exists
- **THEN** the Runtime storage MUST read current-format previously appended entries and MUST not read legacy JSONL

#### Scenario: Shared assignee restarts Runtime
- **WHEN** Koishi changes a shared Channel's assignee and RuntimeManager rebuilds the Runtime
- **THEN** the new Runtime MUST read the same JSONL history

### Requirement: ChannelRuntime Prompt Cache Lifecycle

Each ChannelRuntime MUST own one immutable prompt, tool, model, and provider snapshot for its lifetime. `RuntimeManager` MUST await explicit ChannelRuntime initialization before publishing the runtime. Core MUST append channel events and Agent outputs to history without rebuilding that stable snapshot for each model call.

#### Scenario: Existing ChannelRuntime handles another event

- **WHEN** RuntimeManager routes another accepted event to an active ChannelRuntime
- **THEN** Core MUST reuse the ChannelRuntime's existing stable prompt and tool snapshot
- **AND** the new InputRecord MUST extend the channel's append-only Agent history

#### Scenario: Stable plugin set changes

- **WHEN** Core registration changes the plugin set available to future runtimes
- **THEN** existing ChannelRuntimes MUST retain their current plugin snapshot until explicitly refreshed or replaced

#### Scenario: Runtime construction initializes stable resources

- **WHEN** RuntimeManager creates a ChannelRuntime
- **THEN** it MUST await `ChannelRuntime.init()`
- **AND** the runtime MUST resolve its Agent, plugins, prompt, and tools before RuntimeManager publishes the active entry

### Requirement: Non-Destructive Runtime Refresh

`YesImBotService` MUST expose `reload(scope): Promise<void>` as the explicit trusted path to refresh one ChannelRuntime after a stable prompt, persona, plugin-instruction, tool, model, or provider change. Reload MUST validate current assignment and drain the old runtime without clearing channel history, assets, workspace, Manifest, or registered storage namespaces. The next accepted event MUST build the fresh runtime snapshot lazily.

#### Scenario: Trusted persona source requests refresh

- **WHEN** an operator-managed path or optional persona-management plugin activates new trusted persona content
- **THEN** Core MUST stop admission to the old ChannelRuntime generation
- **AND** it MUST drain and stop that generation before publishing a replacement
- **AND** the replacement MUST read the existing channel JSONL history

#### Scenario: Refresh fails while draining

- **WHEN** the old ChannelRuntime cannot drain or stop cleanly
- **THEN** Core MUST remain fail closed for that channel identity
- **AND** it MUST NOT publish a concurrent replacement runtime
- **AND** it MUST preserve persisted channel data

#### Scenario: Refresh differs from reset

- **WHEN** a caller requests a stable prompt refresh
- **THEN** Core MUST NOT invoke channel reset semantics
- **AND** it MUST NOT clear sessions or assets

#### Scenario: Refresh targets an uncached channel

- **WHEN** a trusted caller requests refresh for a channel with no cached runtime
- **THEN** Core MUST validate current assignment and return without creating a runtime
- **AND** the next accepted event MUST create the runtime from the latest stable sources

#### Scenario: Input races with runtime draining

- **WHEN** an accepted InputRecord reaches a ChannelRuntime after reload has started draining it
- **THEN** ChannelRuntime MUST reject it with a dedicated draining error before persistence
- **AND** RuntimeManager MUST retry that InputRecord through the existing handover path
- **AND** the per-identity handover waiting limit MUST remain five

#### Scenario: Concurrent reload calls coalesce

- **WHEN** multiple callers request reload for the same draining channel identity
- **THEN** they MUST await the same handover operation
- **AND** Core MUST NOT create an additional replacement generation solely for each concurrent call

### Requirement: Prompt File Injection
Core MUST build one cache-stable system input snapshot during `ChannelRuntime.init()`. The snapshot MUST contain the identity-neutral Core Constitution, optional operator policy from `AGENTS.md`, exactly one active persona, stable channel runtime context, and stable plugin instructions in that order. Core MUST use bundled TypeScript constants for the Constitution and default Athena persona, with `CORE_CONSTITUTION_VERSION` set to `1`.

#### Scenario: Core Constitution is loaded
- **WHEN** Core initializes a ChannelRuntime
- **THEN** it MUST use `CORE_CONSTITUTION` as the first immutable system segment
- **AND** it MUST expose `CORE_CONSTITUTION_VERSION` for deterministic version assertions and diagnostics
- **AND** plugins MUST NOT receive an API that can replace that segment

#### Scenario: AGENTS operator policy exists
- **WHEN** `AGENTS.md` exists under the unified base path
- **THEN** Core MUST read it once during ChannelRuntime initialization
- **AND** it MUST append the trimmed content after the Core Constitution inside an `<agents>` system block

#### Scenario: Custom persona exists
- **WHEN** a non-empty `PERSONA.md` exists under the unified base path
- **THEN** Core MUST read it once during ChannelRuntime initialization
- **AND** it MUST use the trimmed content as the single active `<persona>` system block after operator policy
- **AND** it MUST NOT append the default Athena persona

#### Scenario: Custom persona is absent
- **WHEN** `PERSONA.md` is missing or empty during ChannelRuntime initialization
- **THEN** Core MUST append the bundled default Athena persona as the single active `<persona>` system block

#### Scenario: Optional prompt file is missing
- **WHEN** `AGENTS.md` or `PERSONA.md` does not exist
- **THEN** Core MUST treat that source as unconfigured without failing initialization

#### Scenario: Prompt file cannot be read
- **WHEN** `AGENTS.md` or `PERSONA.md` fails with an error other than `ENOENT`
- **THEN** Core MUST log the condition
- **AND** ChannelRuntime initialization MUST fail closed

#### Scenario: Stable runtime context is appended
- **WHEN** Core initializes a ChannelRuntime
- **THEN** it MUST append a `<runtime_context>` system block after the active persona
- **AND** the block MUST contain XML-escaped `platform`, `selfId`, `channelId`, and `isDirect` values from the immutable Channel Scope

#### Scenario: Later model call uses prompt files
- **WHEN** the ChannelRuntime prepares a later model request
- **THEN** Core MUST reuse the frozen prompt-file content from runtime creation
- **AND** it MUST NOT reread either file for that model call

#### Scenario: Prompt source changes
- **WHEN** trusted operator policy or active persona content changes after runtime creation
- **THEN** the new content MUST take effect only through explicit non-destructive runtime refresh

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

### Requirement: Immutable Runtime Media Snapshot
RuntimeManager MUST snapshot the resolved image-input capability and configured model-call media policy when creating a ChannelRuntime. ChannelRuntime MUST reuse that snapshot for its lifetime, and a changed capability or policy MUST activate only through Runtime replacement or explicit non-destructive reload.

#### Scenario: Existing runtime handles another model call
- **WHEN** model metadata or multimedia configuration changes after ChannelRuntime initialization
- **THEN** the active runtime MUST retain its existing media capability and policy snapshot

#### Scenario: Runtime is reloaded
- **WHEN** a trusted caller reloads the channel after a media policy change
- **THEN** the replacement runtime MUST use the latest resolved capability and policy without clearing history or assets
