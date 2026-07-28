## MODIFIED Requirements

### Requirement: Element-Based Resolved Message
A resolved ordinary message MUST carry its content as `elements` only. Gateway MUST
seal those elements once at ingress and persist the sealed result as the sole
structured content field. A resolver MUST NOT supply a rendered `text`, and Gateway
MUST NOT persist one on a Message.

#### Scenario: Resolver returns a message draft
- **WHEN** a resolver returns a message draft with elements
- **THEN** Gateway MUST persist the sealed elements
- **AND** the persisted record MUST NOT contain a `text` field

#### Scenario: Draft contains an image carrying a source URL
- **WHEN** a message draft contains an image element with a remote source
- **THEN** the persisted `elements` MUST contain the sealed form of that image
- **AND** the persisted `elements` MUST NOT retain the original remote source

#### Scenario: Elements are sealed exactly once
- **WHEN** Gateway normalizes and seals a draft
- **THEN** normalization MUST NOT be applied more than once to the same elements

### Requirement: Satori Message Fallback
When no resolver is registered for a platform, Gateway MUST assemble a message
record from explicitly selected Session fields, requiring a routable scope, an
`elements` array, and a non-empty platform message id. Gateway MUST seal the
selected elements and persist them as the sole structured content field, and MUST
NOT persist a rendered `text`.

#### Scenario: Fallback message is persisted
- **WHEN** Gateway assembles a fallback message record
- **THEN** it MUST contain only the literal host fields plus sealed `elements`
- **AND** it MUST NOT contain a `text` field or any platform event residue

#### Scenario: Non-message session without a resolver
- **WHEN** a non-message Session arrives and no resolver is registered
- **THEN** Gateway MUST return without persisting or routing
