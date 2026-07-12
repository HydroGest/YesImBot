## ADDED Requirements

### Requirement: Structured System Prompt Append Hook

The runtime MUST expose an append-only structured system prompt hook for
plugins that need to add system instructions without rewriting the complete
system prompt string.

#### Scenario: Plugin appends string system block
- **WHEN** an active plugin returns a string from the structured system prompt append hook
- **THEN** the runtime MUST append that value as an additional AI SDK system message block

#### Scenario: Plugin appends system model message
- **WHEN** an active plugin returns a `SystemModelMessage` from the structured system prompt append hook
- **THEN** the runtime MUST preserve its `content` and `providerOptions` in the AI SDK system input

#### Scenario: Plugin appends multiple system blocks
- **WHEN** an active plugin returns an array of strings or `SystemModelMessage` values from the structured system prompt append hook
- **THEN** the runtime MUST append each returned block in array order

#### Scenario: Undefined structured append
- **WHEN** the structured system prompt append hook returns `undefined`
- **THEN** the runtime MUST leave the accumulated system prompt input unchanged

#### Scenario: Append-only semantics
- **WHEN** a plugin uses the structured system prompt append hook
- **THEN** the hook MUST NOT receive an API for deleting, replacing, or reordering earlier system prompt blocks

### Requirement: System Prompt Hook Ordering

The runtime MUST compose legacy and structured system prompt hooks in a
deterministic order.

#### Scenario: Legacy hook runs before structured append hook
- **WHEN** the runtime prepares system prompt input for a model call
- **THEN** it MUST run existing `extendSystemPrompt` hooks before structured system prompt append hooks

#### Scenario: Structured append follows plugin order
- **WHEN** multiple active plugins implement the structured system prompt append hook
- **THEN** the runtime MUST evaluate those hooks in deterministic plugin order after plugin `enforce` ordering has been applied

#### Scenario: Legacy-only compatibility
- **WHEN** no active plugin appends structured system prompt blocks
- **THEN** the runtime MUST preserve the legacy final string system prompt shape

## MODIFIED Requirements

### Requirement: Plugin Error Policy

The runtime MUST apply explicit default error policies by hook category.

#### Scenario: Init failure

- **WHEN** a non-optional plugin fails during `init`
- **THEN** agent initialization MUST fail and already initialized plugins MUST be stopped in reverse order

#### Scenario: Optional plugin init failure

- **WHEN** a plugin declared with `optional: true` fails during `init`
- **THEN** the runtime MUST disable that plugin, emit diagnostics, and continue initialization

#### Scenario: Before tool plugin failure

- **WHEN** a `beforeToolCall` hook throws
- **THEN** the runtime MUST block that tool call by default

#### Scenario: Transform plugin failure

- **WHEN** a transform, prompt extension, structured prompt append, tool extension, `toModelMessages`, `afterToolCall`, `onAppend`, or `onTurnFinish` hook throws
- **THEN** the runtime MUST emit a plugin error diagnostic and continue with the previous or fallback value
