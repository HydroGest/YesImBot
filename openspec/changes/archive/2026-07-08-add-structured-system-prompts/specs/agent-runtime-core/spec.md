## MODIFIED Requirements

### Requirement: Runtime Resource Separation

The runtime MUST treat `LanguageModel` and base `systemPrompt` as runtime resources rather than built-in persisted state.

#### Scenario: Model replacement

- **WHEN** the caller replaces the runtime model
- **THEN** the runtime MUST update the model resource without requiring that `LanguageModel` be serialized into storage

#### Scenario: Dynamic system prompt

- **WHEN** the runtime builds a model request
- **THEN** it MUST resolve the configured `systemPrompt` and plugin prompt extensions before invoking `ai-sdk`

#### Scenario: Structured system prompt model input

- **WHEN** one or more active plugins append structured system prompt blocks
- **THEN** the runtime MUST pass the resolved system prompt to `ai-sdk` through the `system` option as AI SDK-compatible system input
- **AND** it MUST NOT inject those structured system prompt blocks into the model `messages` array

#### Scenario: Legacy string prompt compatibility

- **WHEN** no active plugin appends structured system prompt blocks
- **THEN** the runtime MUST continue passing the resolved legacy system prompt as a string to `ai-sdk`

#### Scenario: Structured prompt without base string

- **WHEN** no base `systemPrompt` is configured and one or more active plugins append structured system prompt blocks
- **THEN** the runtime MUST still pass those structured blocks through AI SDK's `system` option
- **AND** it MUST NOT invoke legacy `extendSystemPrompt` without a base string prompt
