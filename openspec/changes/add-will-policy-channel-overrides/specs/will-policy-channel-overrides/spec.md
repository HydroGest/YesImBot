## ADDED Requirements

### Requirement: Channel-scoped willingness overrides

The will-policy plugin SHALL allow willingness configurations to override `textGain` and `keywordMultiplier` for selected channels without changing the global defaults.

#### Scenario: Matching channel uses overrides

- **WHEN** a channel matches an override by platform, channel ID, and optional direct-message flag
- **THEN** the channel-scoped willingness engine uses every value present in that override
- **AND** omitted override fields continue to use their global values

#### Scenario: Rules have deterministic priority

- **WHEN** more than one override matches a channel
- **THEN** only the first matching rule in configuration order is applied

#### Scenario: Unmatched channel remains compatible

- **WHEN** no override matches a channel or the rule table is empty
- **THEN** the engine uses the existing global willingness configuration unchanged

#### Scenario: Direct account IDs are normalized

- **WHEN** an override can match direct messages and its channel ID lacks the `private:` prefix
- **THEN** the plugin matches it against the equivalent `private:<channelId>` runtime channel

#### Scenario: Invalid gains are rejected

- **WHEN** an operator configures a negative `textGain` or `keywordMultiplier` override
- **THEN** configuration validation rejects that value
