## ADDED Requirements

### Requirement: Ordered Stable Prompt Segments

Each ChannelRuntime MUST construct its stable system input in this order: immutable Core Constitution, operator policy, active persona, stable runtime context, and stable plugin instructions. Native tool definitions MUST remain separate from system prose and MUST use deterministic ordering.

#### Scenario: ChannelRuntime builds its first model request
- **WHEN** Core initializes a ChannelRuntime
- **THEN** it MUST resolve each stable prompt source once in the required order
- **AND** later plugins MUST NOT delete, replace, or reorder an earlier segment

#### Scenario: Plugin describes a tool capability
- **WHEN** a plugin provides stable model instructions for its tools
- **THEN** those instructions MUST follow the active persona as stable plugin instructions
- **AND** tool names and schemas MUST remain in the native tool input

### Requirement: ChannelRuntime Cache Lifecycle

A ChannelRuntime MUST own one cache lifecycle whose stable prompt segments, plugin set, native tool registry, model, and provider remain unchanged across model requests.

#### Scenario: Normal turn follows an earlier turn
- **WHEN** the runtime prepares another model request without a cache-lifecycle change
- **THEN** all previously sent stable inputs and historical model messages MUST remain byte-order equivalent
- **AND** new messages MUST extend the earlier request at the tail

#### Scenario: Tool loop continues
- **WHEN** an assistant tool call and matching tool result complete during a turn
- **THEN** the runtime MUST append them to model history
- **AND** the next model step MUST retain the previous model request as its prefix

### Requirement: Append-Only Dynamic Context

Per-turn memory retrieval, goals, state changes, environment changes, current time, and current events MUST enter model context through append-only messages or tool results. They MUST NOT be regenerated as changing system segments before historical messages.

#### Scenario: Model searches long-term memory
- **WHEN** a memory search tool returns results
- **THEN** the tool call and result MUST append to the current turn timeline
- **AND** later requests MUST retain that result at its persisted position

#### Scenario: Plugin performs automatic memory retrieval
- **WHEN** a plugin retrieves memory before model execution without a model tool call
- **THEN** it MUST append one immutable scoped memory snapshot at the current turn boundary
- **AND** it MUST persist that snapshot if later requests are expected to retain it

#### Scenario: Runtime reports current time
- **WHEN** a current event already carries an authoritative timestamp
- **THEN** the system prompt MUST NOT inject a changing global clock before history for the same request

### Requirement: Explicit Cache Invalidation Boundaries

A change to the Core Constitution, operator policy, active persona, stable runtime context, plugin set, stable plugin instructions, native tool registry, model, provider, or historical projection MUST end the current cache lifecycle before the changed value reaches the model.

#### Scenario: Trusted persona source changes
- **WHEN** trusted persona content changes for an existing channel
- **THEN** Core MUST drain and replace the ChannelRuntime through a non-destructive refresh
- **AND** the replacement runtime MUST start a new cache lifecycle

#### Scenario: History compaction rewrites model projection
- **WHEN** compaction removes or replaces model-visible historical content
- **THEN** the runtime MUST treat the compacted projection as a new cache lifecycle
- **AND** it MUST NOT report the rewritten request as a continuation of the old prefix

### Requirement: Cache-Preserving Historical Projection

Within one cache lifecycle, Core model-message conversion and supported plugin surfaces MUST preserve the model-visible prefix produced for all earlier persisted entries. Core and new plugins MUST NOT use the deprecated `transformMessages` compatibility hook.

#### Scenario: Core projects historical messages
- **WHEN** a later model request includes previously projected persisted entries
- **THEN** Core conversion MUST preserve their model-visible content and order

#### Scenario: New capability needs non-prefix history
- **WHEN** a new capability needs to prune, summarize, reorder, or reinterpret previously projected history
- **THEN** it MUST define and trigger a new cache lifecycle before that projection reaches the model
- **AND** it MUST NOT use the deprecated transform hook as an implicit reset mechanism

### Requirement: Provider Cache Adaptation

Provider adapters MAY attach provider-specific cache metadata to stable system or tool segments, but generic prompt text and plugin contracts MUST remain provider-neutral.

#### Scenario: Provider supports explicit cache breakpoints
- **WHEN** an adapter enables an explicit cache breakpoint
- **THEN** it MUST place the breakpoint after a stable segment boundary
- **AND** it MUST NOT require provider-specific instructions in the Core Constitution

