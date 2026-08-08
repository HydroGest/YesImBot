## ADDED Requirements

### Requirement: Stable Global Scope Identity

Core MUST expose a `GlobalScope` with `type: "global"` and a required non-empty `agentId`. A GlobalScope MUST NOT contain or imply a platform, Bot, Session, channel, or delivery target.

#### Scenario: Trusted plugin addresses a GlobalAgent

- **WHEN** a trusted plugin constructs a valid GlobalScope
- **THEN** Core MUST use its `agentId` as the persistent runtime and storage identity
- **AND** Core MUST NOT require channel coordinates

#### Scenario: Invalid global identity is used

- **WHEN** a caller supplies an empty or malformed `agentId`
- **THEN** the global facade MUST reject before creating storage or a runtime

### Requirement: Global Agent Facade
Core MUST expose `ctx.yesimbot.global` as the public GlobalAgent lifecycle interface. The module MUST provide scope-addressed `start`, `submit`, `replace`, `stop`, `clear`, and resource-root operations. Core MUST keep GlobalRuntimeManager and GlobalRuntime private.

#### Scenario: Trusted plugin manages a GlobalAgent
- **WHEN** a trusted plugin calls a global facade operation with a valid GlobalScope
- **THEN** Core MUST perform that operation without returning Runtimes or GlobalRuntime

#### Scenario: Two trusted plugins use the same scope

- **WHEN** two trusted plugins address the same running GlobalScope
- **THEN** both MUST resolve the same GlobalRuntime
- **AND** Core MUST NOT require an exclusive owner handle

### Requirement: Controlled Global Agent Definition

`ctx.yesimbot.global.start()` and `replace()` MUST accept a Core-controlled definition containing a registered model name, structured system prompt, fixed tools, fixed caller-owned `AgentPlugin` instances, compact-persona input, and terminal-tool configuration. Core MUST supply the Agent ID, Agent storage, Global AssetStore, compaction lifecycle, turn scheduling, interruption, and stop behavior. The definition MUST NOT let callers override identity, storage, passive delivery, or Runtime lifecycle.

#### Scenario: Caller starts a GlobalAgent

- **WHEN** a caller supplies a complete valid definition for an inactive GlobalScope
- **THEN** Core MUST resolve the configured model and initialize one Agent with a stable resource snapshot
- **AND** the Agent ID and storage MUST come from Core

#### Scenario: Model name cannot be resolved

- **WHEN** the supplied registered model name is unavailable
- **THEN** start MUST reject
- **AND** Core MUST NOT retain a partially initialized runtime

### Requirement: Explicit Start And Replacement

One `agentId` MUST select at most one running GlobalRuntime. Starting an active scope MUST reject. Replacing an active scope MUST stop the old runtime before creating the new runtime from the complete replacement definition. Stopping a runtime MUST discard its in-memory definition, and later submission MUST NOT recreate it implicitly.

#### Scenario: Two callers start the same inactive scope concurrently

- **WHEN** concurrent start calls target the same agentId
- **THEN** Core MUST create at most one running GlobalRuntime
- **AND** every call that did not create that runtime MUST reject as an active-scope conflict

#### Scenario: Caller replaces a running GlobalAgent

- **WHEN** a caller invokes replace with a complete definition
- **THEN** Core MUST stop the existing runtime before initializing its replacement
- **AND** the replacement MUST reuse the same persistent session identity

#### Scenario: Caller submits after stop

- **WHEN** a GlobalRuntime has stopped and no caller has started it again
- **THEN** submit MUST reject
- **AND** Core MUST NOT reuse the discarded model, tools, prompt, or plugin closures

### Requirement: Custom Message Submission

GlobalRuntime MUST accept existing `AgentMessage` values and MUST NOT define a second GlobalEvent record hierarchy. A caller MAY use declaration-merged custom messages. GlobalRuntime MUST persist an accepted submitted message exactly once before model execution.

#### Scenario: Idle GlobalAgent receives a message

- **WHEN** submit targets an idle GlobalRuntime
- **THEN** Core MUST persist the message and start one finite Agent turn

#### Scenario: Busy GlobalAgent receives a message

- **WHEN** submit targets a GlobalRuntime with an active turn
- **THEN** Core MUST persist the message and join it to that active turn
- **AND** Core MUST NOT start another internal event-stream consumer

### Requirement: Completion-Only Submission Result

`submit()` MUST return a Promise that resolves when the accepting finite turn completes and rejects when that turn fails or aborts. GlobalRuntime MUST consume Agent internal events itself and MUST NOT expose the internal event stream or assistant output as the operation result.

#### Scenario: Submitted turn completes

- **WHEN** the accepting turn reaches normal terminal completion
- **THEN** every submit Promise joined to that turn MUST resolve

#### Scenario: Submitted turn fails

- **WHEN** the accepting turn fails or is aborted
- **THEN** every affected submit Promise MUST reject with that terminal failure

### Requirement: No Implicit Global Output Delivery

GlobalRuntime MUST persist complete assistant and tool messages through the existing Agent storage contract. It MUST NOT parse assistant text as a channel reply, deliver it to a platform, create a default send tool, or treat text generation as an external effect. External effects MUST occur through tools supplied in the start definition.

#### Scenario: WorldAgent emits assistant text

- **WHEN** a GlobalAgent appends a complete assistant text message
- **THEN** the message MUST remain in its Agent session
- **AND** Core MUST NOT send it to any platform channel

### Requirement: Global Runtime Stop And Clear

Stopping a GlobalRuntime MUST close new admission, interrupt the active Agent turn and tools, stop initialized AgentPlugin instances, release in-memory resources, and preserve all persisted data. Clearing a GlobalScope MUST stop its runtime if present, remove only the Core-owned `sessions/` and `assets/` children, preserve the Manifest and every other child, and leave the scope inactive.

#### Scenario: Stop occurs during an active tool

- **WHEN** stop or replace targets a GlobalRuntime with active work
- **THEN** Core MUST signal cancellation and wait for runtime teardown
- **AND** its session and assets MUST remain available for a later explicit start

#### Scenario: Inactive GlobalScope is cleared

- **WHEN** clear targets a valid scope without a running runtime
- **THEN** Core MUST still attempt session and asset cleanup
- **AND** it MUST preserve domain-owned children

### Requirement: Global Agent Storage Root

Core MUST create GlobalAgent roots below `agents/` using a safe deterministic encoding of `agentId`. Core MUST create and validate an authoritative `agent.json` containing `type: "global"`, `agentId`, and `createdAt` before returning the root. Core MUST reject malformed, mismatched, escaping, or symlinked storage entries without overwriting them.

#### Scenario: Global storage is first requested

- **WHEN** `resource.get()` first receives a valid GlobalScope
- **THEN** Core MUST atomically create its Manifest and return the complete Agent resource root

#### Scenario: Existing Manifest identity differs

- **WHEN** an existing Agent root has a Manifest whose agentId does not match the requested scope
- **THEN** Core MUST reject the root
- **AND** Core MUST NOT repair or overwrite it

### Requirement: Global Asset Isolation

The public resource facade MUST create a GlobalScope owner rooted in that Agent's `assets/` child. A GlobalScope owner MUST use the existing asset ID, prefix resolution, deduplication, and clear behavior. It MUST NOT implicitly resolve an asset from any ChannelScope owner.

#### Scenario: Same asset reference exists in two scopes

- **WHEN** a GlobalAgent and a channel contain the same asset ID
- **THEN** each store MUST resolve only bytes below its own scoped root

### Requirement: Global Shutdown Integration

Core global stop MUST close GlobalAgent admission, stop every running GlobalRuntime, wait for their teardown, and preserve their sessions, assets, Manifests, and domain-owned children. A failure in one GlobalRuntime MUST NOT prevent Core from attempting to stop the others.

#### Scenario: Core stops with several GlobalAgents

- **WHEN** Core stop begins while several GlobalScopes are running
- **THEN** Core MUST attempt to stop every GlobalRuntime
- **AND** no GlobalRuntime may accept a later submit

### Requirement: Registered Channel Plugins Remain Channel-Only

This change MUST NOT make GlobalRuntime discover, adapt, or initialize channel plugin objects registered through `agent.use()`. A GlobalAgent MUST use only the fixed tools and private AgentPlugin instances supplied in its explicit definition.

#### Scenario: MCP channel plugin is registered
- **WHEN** a caller starts a GlobalAgent without directly supplying an MCP AgentPlugin instance
- **THEN** Core MUST NOT install the registered channel MCP object into that GlobalAgent
