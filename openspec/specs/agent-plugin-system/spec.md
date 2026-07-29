# agent-plugin-system Specification

## Requirements

### Requirement: Plugin factories receive scope and Bot directly
An `AgentPluginFactory` MUST be called as `factory(scope, bot)` and may declare `requiresMessageId`.

#### Scenario: Core creates a channel runtime
- **WHEN** it initializes agent plugins
- **THEN** each factory receives the immutable ChannelScope and the current Bot as separate arguments

### Requirement: Plugins use the runtime's current Bot
Plugins that need platform operations MUST use the supplied Bot and MUST NOT perform a separate Bot registry lookup.

#### Scenario: A shared channel changes Bot
- **WHEN** Core replaces the runtime for the new Bot
- **THEN** newly initialized plugins receive that Bot
