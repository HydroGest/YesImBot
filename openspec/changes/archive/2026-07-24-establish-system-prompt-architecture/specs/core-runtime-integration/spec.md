## ADDED Requirements

### Requirement: ChannelRuntime Prompt Cache Lifecycle

Each ChannelRuntime MUST own one immutable prompt, tool, model, and provider snapshot for its lifetime. `RuntimeManager` MUST await explicit ChannelRuntime initialization before publishing the runtime. Core MUST append channel events and Agent outputs to history without rebuilding that stable snapshot for each model call.

#### Scenario: Existing ChannelRuntime handles another event
- **WHEN** RuntimeManager routes another accepted event to an active ChannelRuntime
- **THEN** Core MUST reuse the ChannelRuntime's existing stable prompt and tool snapshot
- **AND** the new EventRecord MUST extend the channel's append-only Agent history

#### Scenario: Stable plugin set changes
- **WHEN** Core registration changes the plugin set available to future runtimes
- **THEN** existing ChannelRuntimes MUST retain their current plugin snapshot until explicitly refreshed or replaced

#### Scenario: Runtime construction initializes stable resources
- **WHEN** RuntimeManager creates a ChannelRuntime
- **THEN** it MUST await `ChannelRuntime.init()`
- **AND** the runtime MUST resolve its Agent, plugins, prompt, and tools before RuntimeManager publishes the active entry

### Requirement: Non-Destructive Runtime Refresh

`YesImBotService` MUST expose `reload(scope): Promise<void>` as the explicit trusted path to refresh one ChannelRuntime after a stable prompt, persona, plugin-instruction, tool, model, or provider change. Reload MUST validate current assignment and drain the old runtime without clearing channel history, assets, workspace, manifest, catalog, or registered storage namespaces. The next accepted event MUST build the fresh runtime snapshot lazily.

#### Scenario: Trusted persona source requests refresh
- **WHEN** an operator-managed path or optional persona-management plugin activates new trusted persona content
- **THEN** Core MUST stop admission to the old ChannelRuntime generation
- **AND** it MUST drain and stop that generation before publishing a replacement
- **AND** the replacement MUST read the existing channel JSONL history

#### Scenario: Refresh fails while draining
- **WHEN** the old ChannelRuntime cannot drain or stop cleanly
- **THEN** Core MUST remain fail closed for that Channel Key
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

#### Scenario: Event races with runtime draining
- **WHEN** an accepted EventRecord reaches a ChannelRuntime after reload has started draining it
- **THEN** ChannelRuntime MUST reject it with a dedicated draining error before persistence
- **AND** RuntimeManager MUST retry that EventRecord through the existing handover path
- **AND** the per-Key handover waiting limit MUST remain five

#### Scenario: Concurrent reload calls coalesce
- **WHEN** multiple callers request reload for the same draining Channel Key
- **THEN** they MUST await the same handover operation
- **AND** Core MUST NOT create an additional replacement generation solely for each concurrent call

## MODIFIED Requirements

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
