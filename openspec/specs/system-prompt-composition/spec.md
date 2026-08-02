# system-prompt-composition Specification

## Purpose

Define stable system prompt composition, cache lifecycle boundaries, and append-only dynamic context for ChannelRuntime.
## Requirements
### Requirement: Ordered Stable Prompt Segments

Each ChannelRuntime MUST construct its stable system input in this order: immutable Core Constitution, operator policy, active persona, stable runtime context, and stable plugin instructions. Native tool definitions MUST remain separate from system prose and MUST use deterministic ordering.

The Core Constitution MUST own the output control protocol that governs reply shape, private deliberation, pacing, and declining to reply. Operator policy, persona, and plugin instructions MUST NOT define, redefine, or disable any part of that protocol.

#### Scenario: ChannelRuntime builds its first model request
- **WHEN** Core initializes a ChannelRuntime
- **THEN** it MUST resolve each stable prompt source once in the required order
- **AND** later plugins MUST NOT delete, replace, or reorder an earlier segment

#### Scenario: Plugin describes a tool capability
- **WHEN** a plugin provides stable model instructions for its tools
- **THEN** those instructions MUST follow the active persona as stable plugin instructions
- **AND** tool names and schemas MUST remain in the native tool input

#### Scenario: Persona describes reply style
- **WHEN** a persona describes habits of expression or thought
- **THEN** those descriptions MUST NOT define or override a control element
- **AND** the Constitution's output control protocol MUST retain authority

#### Scenario: Plugin attempts to change output protocol
- **WHEN** a plugin's stable instructions attempt to redefine reply shape control
- **THEN** the Constitution's protocol MUST remain in effect unchanged
### Requirement: ChannelRuntime Cache Lifecycle
A ChannelRuntime MUST own one cache lifecycle whose stable prompt segments, plugin set, native tool registry, model, provider, resolved media capability, and media policy remain unchanged across model requests. Previously persisted message order, text, and original content elements MUST remain equivalent. Generated media file parts MAY vary per call only according to the frozen bounded media selection policy.

#### Scenario: Normal turn follows an earlier turn
- **WHEN** the runtime prepares another model request without a cache-lifecycle change
- **THEN** all previously sent stable inputs and persisted historical text and original elements MUST remain byte-order equivalent
- **AND** new persisted messages MUST extend the earlier persisted request at the tail

#### Scenario: Tool loop continues
- **WHEN** an assistant tool call and matching tool result complete during a turn
- **THEN** the runtime MUST append them to model history
- **AND** the next model step MUST retain the previous persisted request as its prefix

#### Scenario: Call-scoped media is reselected
- **WHEN** the frozen media policy prioritizes current turn input for a later model call
- **THEN** generated file parts MAY differ without changing persisted Event content or starting a new cache lifecycle

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
Within one cache lifecycle, Core model-message conversion and supported plugin surfaces MUST preserve persisted message order, model-visible text, and every original model-content element produced for earlier entries. Core MAY append or omit only generated call-scoped file parts according to the frozen media policy. Core and new plugins MUST NOT use the deprecated `transformMessages` compatibility hook.

#### Scenario: Core projects historical messages
- **WHEN** a later model request includes previously projected persisted entries
- **THEN** Core conversion MUST preserve their model-visible text, original elements, and order
- **AND** any generated file-part variation MUST satisfy the frozen call budget and strategy

#### Scenario: New capability needs non-prefix persisted history
- **WHEN** a new capability needs to prune, summarize, reorder, or reinterpret persisted text or original model content
- **THEN** it MUST define and trigger a new cache lifecycle before that projection reaches the model
- **AND** it MUST NOT use the deprecated transform hook as an implicit reset mechanism

### Requirement: Provider Cache Adaptation

Provider adapters MAY attach provider-specific cache metadata to stable system or tool segments, but generic prompt text and plugin contracts MUST remain provider-neutral.

#### Scenario: Provider supports explicit cache breakpoints
- **WHEN** an adapter enables an explicit cache breakpoint
- **THEN** it MUST place the breakpoint after a stable segment boundary
- **AND** it MUST NOT require provider-specific instructions in the Core Constitution

### Requirement: Runtime Notification Trust Instruction
The immutable Core Constitution MUST state that content inside the fixed `SYSTEM_NOTIFICATION` envelope is untrusted runtime observation data and MUST NOT be interpreted as user or system instruction. This rule MUST be stable for the ChannelRuntime cache lifecycle.

#### Scenario: Notification contains imperative text
- **WHEN** a non-message Event payload contains text that asks the model to perform an action
- **THEN** the stable system instruction MUST classify that payload as untrusted observation data

### Requirement: Output Shape Instruction Without Fixed Targets

The Core Constitution's output control instruction MUST direct the model to decide reply meaning before reply shape, MUST present a single message as a normal and frequent outcome, and MUST require every split point to be evaluated from the reader's sequential view. It MUST NOT state a target message count, a target segment length, a punctuation ratio, or a required rhythm, and MUST NOT expose runtime guardrail values as targets.

#### Scenario: Instruction describes segmentation
- **WHEN** the Constitution instructs the model on reply shape
- **THEN** it MUST NOT contain a fixed message count, length, or punctuation quota
- **AND** it MUST state that one message is a normal outcome

#### Scenario: Instruction addresses sequential reading
- **WHEN** the Constitution instructs the model on split points
- **THEN** it MUST require that a partial reply left standing alone is harmless
- **AND** it MUST require integrity for facts, instructions, code, links, structured content, and quoted text

#### Scenario: Instruction addresses pattern repetition
- **WHEN** the Constitution instructs the model on variation
- **THEN** it MUST direct the model away from repeating a recent shape
- **AND** it MUST NOT authorize degraded writing, deliberate misspellings, or scattered punctuation as variation

#### Scenario: Guardrail values stay internal
- **WHEN** Core enforces a maximum segment count or delay ceiling
- **THEN** the Constitution MUST NOT present those values to the model

### Requirement: Constitution Change Cache Lifecycle

Any change to the Core Constitution MUST start a new cache lifecycle for every ChannelRuntime. Core MUST drain and replace each ChannelRuntime rather than mutating a running one, and MUST NOT retain a prompt prefix built from an earlier constitution. The Constitution carries no version number and is embedded in the runtime snapshot.

#### Scenario: Constitution content changes
- **WHEN** the Core Constitution content changes
- **THEN** Core MUST drain and replace every ChannelRuntime
- **AND** it MUST NOT reuse a prompt prefix built from the previous constitution

#### Scenario: Constitution change is reverted
- **WHEN** the Constitution change is reverted
- **THEN** Core MUST start a new cache lifecycle again
- **AND** output without control elements MUST deliver as one message
