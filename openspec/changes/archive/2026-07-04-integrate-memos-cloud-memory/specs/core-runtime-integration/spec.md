## ADDED Requirements

### Requirement: Default Runtime Terminal Tool Enablement
Core MUST enable the agent-runtime built-in terminal tool by default when creating yesimbot channel runtimes.

#### Scenario: Channel runtime enables finalize response
- **WHEN** core creates an Agent runtime for a channel
- **THEN** it MUST enable terminal tool support in the Agent configuration
- **AND** it MUST use `finalize_response` as the default terminal tool name

#### Scenario: Terminal tool does not replace assistant rendering
- **WHEN** a turn produces assistant text and then calls `finalize_response`
- **THEN** core MUST continue to render non-empty assistant text messages through the existing assistant text rendering path
- **AND** it MUST NOT render the terminal tool result as user-visible chat text

#### Scenario: Terminal tool supports post-text tool calls
- **WHEN** a model response contains assistant text, additional tool calls, and `finalize_response`
- **THEN** core MUST wait for the turn result as usual
- **AND** it MUST send the assistant text after the turn settles
- **AND** it MUST NOT require an additional model generation after `finalize_response`
