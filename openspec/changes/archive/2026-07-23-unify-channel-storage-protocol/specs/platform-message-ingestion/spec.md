## ADDED Requirements

### Requirement: Database-Backed Shared Channel Admission

Core MUST declare Koishi Database as a required dependency and MUST use the Koishi Channel row as the only assignee authority for shared Sessions.

#### Scenario: Current assignee sends an event
- **WHEN** Gateway receives a shared Session
- **AND** the database Channel identified by `platform` and `channelId` has `assignee` equal to `session.selfId`
- **THEN** Gateway MUST allow the Session to proceed to Resolver selection

#### Scenario: Non-assignee sends an event
- **WHEN** the database assignee differs from `session.selfId`
- **THEN** Gateway MUST reject the Session before Resolver work, image freezing, persistence, or Runtime creation
- **AND** direct mention or command-prefix routing MUST NOT bypass this check for the YesImBot Agent Runtime

#### Scenario: Assignee cannot be resolved
- **WHEN** the Channel row is missing, assignee is empty, or the database query fails
- **THEN** Gateway MUST reject the shared Session without side effects

### Requirement: Direct Channel Admission

Gateway MUST isolate direct Sessions by their real `selfId` and MUST NOT use Koishi shared-channel assignee state for them.

#### Scenario: Direct Session arrives
- **WHEN** Gateway receives a direct Session
- **THEN** it MUST skip shared-channel assignee lookup
- **AND** it MUST preserve `session.selfId` in `ChannelScope`

### Requirement: Assignee Revalidation

Core MUST revalidate shared-channel assignee state at the point where a resolved event enters the per-Key Runtime lifecycle coordinator.

#### Scenario: Assignment changes while event waits
- **WHEN** Gateway admitted a Session but the database assignee changes before Runtime submission
- **THEN** Core MUST reject the stale event
- **AND** it MUST NOT append the event or create a Runtime for the old assignee

#### Scenario: State-changing command runs
- **WHEN** a Koishi command attempts to reset or otherwise mutate YesImBot shared-channel state
- **THEN** Core MUST apply the same database assignee check before the mutation
