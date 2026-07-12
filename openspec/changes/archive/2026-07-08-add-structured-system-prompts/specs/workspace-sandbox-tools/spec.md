## MODIFIED Requirements

### Requirement: Workspace System Prompt

The workspace plugin SHALL extend the agent system prompt with channel-aware workspace sandbox instructions through the structured system prompt append hook.

#### Scenario: Prompt describes sandbox policy

- **WHEN** the workspace plugin extends the system prompt
- **THEN** the prompt includes the current working directory, workspace scope, network state, command timeout, and shell state persistence behavior

#### Scenario: Prompt describes mounted paths

- **WHEN** configured mounts exist
- **THEN** the prompt identifies writable, read-only, and overlay virtual paths without exposing unnecessary host filesystem details

#### Scenario: Prompt guidance remains system input

- **WHEN** the workspace plugin appends sandbox instructions
- **THEN** those instructions MUST be appended through AI SDK system input rather than through historical message transformation
