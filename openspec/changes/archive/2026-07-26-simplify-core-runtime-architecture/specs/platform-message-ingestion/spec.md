## MODIFIED Requirements

### Requirement: Database-Backed Shared Channel Admission
Core MUST declare Koishi Database as a required dependency and MUST use the Koishi Channel row as the only assignee authority for shared Sessions. Gateway MUST query that row exactly once for each shared external Session, before Resolver selection, image freezing, persistence, Runtime creation, or other Runtime work. A successful Gateway check establishes the event's assignee snapshot.

#### Scenario: Current assignee sends an event
- **WHEN** Gateway receives a shared Session
- **AND** the database Channel identified by `platform` and `channelId` has `assignee` equal to `session.selfId`
- **THEN** Gateway MUST allow the Session to proceed to Resolver selection
- **AND** it MUST retain that successful check as the event's assignee snapshot

#### Scenario: Non-assignee sends an event
- **WHEN** the database assignee differs from `session.selfId`
- **THEN** Gateway MUST reject the Session before Resolver work, image freezing, persistence, or Runtime creation
- **AND** direct mention or command-prefix routing MUST NOT bypass this check for the YesImBot Agent Runtime

#### Scenario: Assignee cannot be resolved
- **WHEN** the Channel row is missing, assignee is empty, or the database query fails
- **THEN** Gateway MUST reject the shared Session without side effects

### Requirement: Assignee Revalidation
Core MUST use Gateway admission as the assignee snapshot for an ordinary admitted event and MUST NOT query shared-channel assignee state again before that event reaches Runtime submission or persistence. Reload, reset, and any other shared-channel lifecycle mutation MUST query current database assignee state inside the per-identity lifecycle operation before changing a Runtime or persisted state.

#### Scenario: Assignment changes after Gateway admission
- **WHEN** Gateway admitted a shared Session
- **AND** the database assignee changes before Runtime submission
- **THEN** Core MUST continue to use the Gateway admission snapshot for that event
- **AND** it MUST NOT issue a second assignee query for that event

#### Scenario: State-changing command runs
- **WHEN** a Koishi command attempts to reload, reset, or otherwise mutate YesImBot shared-channel state
- **THEN** Core MUST apply a current database assignee check inside the lifecycle operation before the mutation

## ADDED Requirements

### Requirement: Cached Runtime Assignee Mismatch
Core MUST fail closed when an admitted shared event's `selfId` differs from the cached Runtime's `selfId`. Core MUST detect that mismatch before persistence, MUST NOT automatically drain, replace, retry, or create a Runtime from the event route, and MUST require an explicit reload for the channel.

#### Scenario: Admitted event reaches a Runtime for another self ID
- **WHEN** Gateway admitted a shared event under its assignee snapshot
- **AND** a cached Runtime for the same `channelIdentity` has a different `selfId`
- **THEN** Runtime routing MUST reject the event with a reload-required error before persistence
- **AND** it MUST preserve the cached Runtime and persisted channel data

#### Scenario: Operator reloads after an assignee change
- **WHEN** an operator explicitly reloads the shared channel
- **THEN** Core MUST validate the current database assignee before changing the cached Runtime
- **AND** the next admitted event MUST lazily create a Runtime with the reloaded scope's `selfId`
