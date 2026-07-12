## MODIFIED Requirements

### Requirement: Prompt File Injection

Core MUST inject prompt sources in the first-version prompt order.

#### Scenario: Core system prompt

- **WHEN** core builds the runtime system prompt
- **THEN** it MUST include core identity, channel context, message presentation notes, and a light plain-text output instruction

#### Scenario: AGENTS prompt extension

- **WHEN** `AGENTS.md` exists under the unified base path
- **THEN** core MUST append its content to the runtime system input through a built-in structured system prompt append plugin

#### Scenario: PERSONA prompt extension

- **WHEN** `PERSONA.md` exists under the unified base path
- **THEN** core MUST append its content to the runtime system input through the same built-in structured system prompt append plugin after the `AGENTS.md` content

#### Scenario: Prompt file missing

- **WHEN** `AGENTS.md` or `PERSONA.md` cannot be read
- **THEN** core MUST continue with the available prompt content and log the condition

#### Scenario: Prompt extension stays in system prompt

- **WHEN** prompt file content is injected
- **THEN** those prompt files MUST remain part of the runtime system input sent through AI SDK's `system` option
- **AND** core MUST NOT duplicate the same content through `transformMessages`
