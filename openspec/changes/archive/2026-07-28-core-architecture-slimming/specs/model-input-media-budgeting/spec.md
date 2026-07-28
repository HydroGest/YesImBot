## MODIFIED Requirements

### Requirement: Deterministic Image Selection Strategies
Core MUST discover frozen image references by walking persisted Message `elements` in
document order, and MUST order candidates across inputs by the configured selection
strategy. Core MUST NOT recover references by parsing a rendered text projection, and
selection MUST remain deterministic for identical persisted input.

#### Scenario: Candidates are discovered
- **WHEN** Core builds the candidate sequence for a turn
- **THEN** it MUST read references from persisted `elements`
- **AND** references within one input MUST follow element document order

#### Scenario: Same history is projected twice
- **WHEN** the same persisted history is projected on two turns with identical configuration
- **THEN** the selected candidate sequence MUST be identical

#### Scenario: Nested elements carry a reference
- **WHEN** a frozen image reference appears inside a nested element
- **THEN** Core MUST discover it by walking element children
