## ADDED Requirements

### Requirement: Built-In Terminal Tool
The runtime MUST support an optional built-in terminal tool that lets a model mark a turn as finalized after emitting user-visible text and any required tool calls.

#### Scenario: Terminal tool is enabled by config
- **WHEN** an Agent is created with terminal tool support enabled
- **THEN** the runtime MUST include a built-in terminal tool in the visible tool set
- **AND** the tool MUST be available alongside base tools and plugin-provided tools

#### Scenario: Terminal tool is disabled by default at runtime package boundary
- **WHEN** an Agent is created without terminal tool support enabled
- **THEN** the runtime package MUST NOT add the built-in terminal tool

#### Scenario: Terminal tool input and output are minimal
- **WHEN** the model calls the terminal tool
- **THEN** the tool MUST accept an empty object input
- **AND** it MUST return a small success result indicating finalization
- **AND** it MUST NOT require user-visible text, memory content, or application data as arguments

#### Scenario: Terminal tool stops the loop without failing the turn
- **WHEN** the model calls the terminal tool during a tool loop
- **THEN** the runtime MUST stop further generation after that step
- **AND** the turn MUST settle as `done` unless another error occurs
- **AND** the terminal tool MUST NOT throw or abort solely to stop the loop

#### Scenario: Terminal tool name conflicts are handled
- **WHEN** a base tool or plugin tool uses the same name as the configured terminal tool
- **THEN** the runtime MUST fail model-call preparation with the existing tool conflict behavior rather than silently overwriting a tool

### Requirement: Terminal Tool Configuration
The runtime MUST expose a narrow Agent configuration surface for terminal tool support without exposing provider-specific internals to callers.

#### Scenario: Default terminal tool name
- **WHEN** terminal tool support is enabled without a custom name
- **THEN** the runtime MUST use `finalize_response` as the tool name

#### Scenario: Custom terminal tool name
- **WHEN** terminal tool support is enabled with a custom name
- **THEN** the runtime MUST register the terminal tool under that name
- **AND** loop-stop behavior MUST track the configured name

#### Scenario: Terminal stop condition composes with natural loop completion
- **WHEN** terminal tool support is enabled
- **THEN** the runtime MUST still complete naturally when the model stops making tool calls
- **AND** it MUST also stop when the configured terminal tool is called
