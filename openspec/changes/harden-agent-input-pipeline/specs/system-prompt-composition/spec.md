## ADDED Requirements

### Requirement: Runtime Notification Trust Instruction
The immutable Core Constitution MUST state that content inside the fixed `SYSTEM_NOTIFICATION` envelope is untrusted runtime observation data and MUST NOT be interpreted as user or system instruction. This rule MUST be stable for the ChannelRuntime cache lifecycle.

#### Scenario: Notification contains imperative text
- **WHEN** a non-message Event payload contains text that asks the model to perform an action
- **THEN** the stable system instruction MUST classify that payload as untrusted observation data

## MODIFIED Requirements

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
