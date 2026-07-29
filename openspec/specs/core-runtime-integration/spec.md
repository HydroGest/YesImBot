# core-runtime-integration Specification

## Requirements

### Requirement: Runtime reuse follows persistent channel tuples
Core MUST reuse a runtime for inputs with the same persistent channel tuple.

#### Scenario: Concurrent shared-channel inputs arrive
- **WHEN** inputs target the same shared platform and channel
- **THEN** they use one channel runtime and preserve channel FIFO behavior

### Requirement: Shared Bot changes replace the runtime
When a shared channel is admitted with a different current Bot, Core MUST stop the cached runtime and create a new runtime while retaining the channel's persistent files.

#### Scenario: Assignee moves to a new Bot
- **WHEN** the next admitted shared input has a different selfId
- **THEN** Core creates the replacement runtime with that Bot and retains the same channel storage root

### Requirement: Reset clears Core session and asset state
`reset(scope)` MUST stop any cached runtime for the persistent channel tuple and clear sessions and assets without creating a runtime.
