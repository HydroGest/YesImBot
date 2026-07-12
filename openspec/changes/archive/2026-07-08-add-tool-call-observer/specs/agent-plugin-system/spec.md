## ADDED Requirements

### Requirement: Failed Tool Result Hook Observability

The runtime MUST expose failed tool executions to `afterToolCall` hooks with an error result context before the tool failure is reported back through model tool execution.

#### Scenario: Failed tool reaches after hook
- **WHEN** a tool `execute` function throws during a turn
- **THEN** the runtime MUST call active `afterToolCall` hooks with the same tool call id, tool name, and final arguments
- **AND** the result context MUST set `isError` to `true`
- **AND** the result context MUST include a diagnostic-like error result

#### Scenario: Failed tool after hook remains fail-open
- **WHEN** an `afterToolCall` hook throws while observing a failed tool call
- **THEN** the runtime MUST emit a plugin error diagnostic and continue reporting the original tool failure according to the existing tool execution behavior

#### Scenario: Failed tool result replacement does not mask execution failure
- **WHEN** an `afterToolCall` hook returns a patched result while observing a failed tool call
- **THEN** the runtime MUST NOT treat the original tool execution as successful solely because a hook returned a patched result
