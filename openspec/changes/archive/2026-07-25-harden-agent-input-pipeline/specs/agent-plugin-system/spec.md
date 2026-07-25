## ADDED Requirements

### Requirement: Read-Only Model Conversion Boundary
The existing `toModelMessages` hook context MUST expose read-only `history` and `current` AgentMessage arrays for that one `buildModelMessages` call. `history` MUST contain the compatibility-transformed historical array that will be converted, and `current` MUST contain only the untouched batch newly submitted for this model request. The runtime MUST create a fresh context identity for each call and MUST preserve final output order as history followed by current.

#### Scenario: Initial request converts a submitted batch
- **WHEN** `buildModelMessages` converts history and an initial submitted batch
- **THEN** every `toModelMessages` invocation for that call MUST receive the same context object
- **AND** its `current` array MUST contain that submitted batch in order

#### Scenario: Later tool step has no new input
- **WHEN** a later model step rebuilds messages without a newly submitted batch
- **THEN** the conversion context's `current` array MUST be empty
- **AND** earlier inputs MUST appear only in history at their persisted positions

#### Scenario: Joined batch reaches a model step
- **WHEN** newly joined messages are drained before a later model step
- **THEN** the conversion context's `current` array MUST contain only that newly drained batch

#### Scenario: Deprecated historical transform runs
- **WHEN** compatibility `transformMessages` changes historical messages before conversion
- **THEN** the context MUST expose that transformed history
- **AND** it MUST keep current input outside the deprecated transform

### Requirement: No Additional Media Preparation Hook
AgentPlugin MUST NOT add a media-specific or side-effect-only model-message preparation hook. Call-aware custom-message conversion MUST use the existing `toModelMessages` hook and its read-only boundary context, and MUST NOT restore deprecated `transformMessages` as a media pipeline.

#### Scenario: Core selects call-scoped media
- **WHEN** Core needs the complete model-call boundary to allocate image budget
- **THEN** it MUST inspect the read-only `toModelMessages` context
- **AND** it MUST NOT mutate, delete, replace, or reorder source AgentMessages
