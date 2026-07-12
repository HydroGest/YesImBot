## MODIFIED Requirements

### Requirement: Memory Prompt Policy

The MemOS client Agent plugin MUST extend the system prompt with a long-term memory usage policy that instructs the model to search before answering, selectively write durable memory after final text, and terminate with the runtime terminal tool. The plugin MUST append that policy through the structured system prompt append hook.

#### Scenario: Prompt instructs search-before-answer

- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to call `search_message` before answering user questions when relevant long-term memory may help
- **AND** it MUST instruct the model to use only memories that are relevant, same-subject, and not contradicted by current input

#### Scenario: Same-context imported memory use

- **WHEN** the plugin extends the system prompt
- **THEN** it MUST instruct the model to use imported historical memories only when they are relevant, same-context, same-subject, and not contradicted by the current message
- **AND** it MUST instruct the model not to generalize one group member's statement into a global user fact

#### Scenario: Sensitive or uncertain memory

- **WHEN** retrieved memory appears sensitive, uncertain, stale, or about another person
- **THEN** the prompt MUST instruct the model to avoid relying on it unless the current context clearly makes it appropriate

#### Scenario: Prompt instructs selective write-after-answer

- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to write user-visible final text before memory write tools
- **AND** it MUST instruct the model to call `add_message` only for new stable facts, durable preferences, project background, or long-term useful group information
- **AND** it MUST instruct the model not to write transient requests, duplicates, secrets, credentials, payment data, sensitive personal data, or short-lived emotions

#### Scenario: Prompt instructs terminal completion

- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to call `finalize_response({})` after required memory tools so the runtime does not continue generating

#### Scenario: Prompt policy remains system input

- **WHEN** the MemOS Agent plugin appends the memory policy
- **THEN** that policy MUST be appended through AI SDK system input rather than through historical message transformation
