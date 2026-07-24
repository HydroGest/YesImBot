## MODIFIED Requirements

### Requirement: Append-Only Model Request Prefix
Within one Agent cache lifecycle, the runtime MUST preserve persisted message order, every previously projected text value, and every original model-content element, and MUST append new current messages, assistant responses, tool calls, and tool results after that persisted prefix. Call-scoped generated media file parts MAY vary under the configured bounded selection strategy and MUST NOT be treated as persisted message content or as permission to reorder messages.

#### Scenario: Later turn prepares a model request
- **WHEN** an earlier turn's messages remain in storage and no stable cache-lifecycle input changed
- **THEN** the later request MUST retain earlier persisted messages, text, and original content elements as an equivalent ordered prefix
- **AND** it MUST append later persisted messages in storage order

#### Scenario: Tool loop prepares another model step
- **WHEN** a step persists assistant tool calls and matching tool results
- **THEN** the next step MUST append those messages after the prior persisted request
- **AND** it MUST NOT regenerate or reorder earlier persisted text or original content elements

#### Scenario: Call-scoped media strategy changes selected history
- **WHEN** the configured current-first or LIFO budget selects a different set of generated historical file parts for a later request
- **THEN** the runtime MAY vary only those generated file parts
- **AND** it MUST preserve each owning message's original content and ordered position

#### Scenario: Tool step has no new current batch
- **WHEN** a later tool step rebuilds model input without newly joined messages
- **THEN** prior turn inputs MUST remain ordinary persisted history
- **AND** the runtime MUST NOT retain or expose a separate active-turn input identity for media selection
