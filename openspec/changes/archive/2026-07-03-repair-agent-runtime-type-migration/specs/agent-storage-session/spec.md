## ADDED Requirements

### Requirement: Runtime Storage Write Ordering
The runtime MUST preserve append-only storage ordering for runtime-originated writes.

#### Scenario: Concurrent runtime writes
- **WHEN** state updates, event persistence, submitted messages, appended observations, assistant outputs, or tool results are written by the runtime during overlapping asynchronous operations
- **THEN** the runtime MUST sequence those writes so later model context construction observes a deterministic append order

---

## MODIFIED Requirements

### Requirement: Append-Only Entry Model
Persisted runtime data MUST use `AgentEntry` records with required `id`, `type`, `data`, `timestamp`, and optional `parentId`. `AgentEntry.id` MUST identify the persisted record. `AgentEntry.parentId` MUST be reserved for tree-shaped entry relationships and MUST NOT be used for turn membership.

#### Scenario: Message entry persistence
- **WHEN** the runtime persists a message
- **THEN** it MUST append an entry whose type identifies message data and whose data contains the `AgentMessage`

#### Scenario: Entry id has no message id counterpart
- **WHEN** an entry contains an `AgentMessage`
- **THEN** the storage model MUST preserve `AgentEntry.id` without requiring or creating an `AgentMessage` id

#### Scenario: Parent id reserved for entry trees
- **WHEN** the runtime persists a message, state, event, or custom entry as part of a turn
- **THEN** it MUST NOT use `AgentEntry.parentId` to store that turn id

#### Scenario: Plugin custom entry
- **WHEN** a plugin declares a custom entry type
- **THEN** the runtime storage contract MUST preserve that entry without requiring core code to understand its semantics

### Requirement: Step Output Persistence
Complete assistant messages and tool results MUST be persisted as entries when each step completes.

#### Scenario: Assistant output persisted
- **WHEN** an assistant message completes during a turn
- **THEN** storage MUST receive a message entry containing that assistant message
- **AND** the runtime MUST NOT write the turn id into the message or into `AgentEntry.parentId`

#### Scenario: Tool result persisted
- **WHEN** a tool result completes during a turn
- **THEN** storage MUST receive a message or tool-result entry that preserves the result
- **AND** the runtime MUST NOT write the turn id into the message or into `AgentEntry.parentId`

#### Scenario: Delta omitted from storage
- **WHEN** a streaming delta is emitted during a turn
- **THEN** storage MUST NOT receive a delta entry by default

### Requirement: Agent Event Persistence Policy
The runtime MUST default to persisting only abnormal terminal agent events.

#### Scenario: Failed turn persistence
- **WHEN** a turn fails
- **THEN** the runtime MUST persist an event entry representing the failure by default
- **AND** the event data MUST carry the relevant `turnId`

#### Scenario: Aborted turn persistence
- **WHEN** a turn is aborted
- **THEN** the runtime MUST persist an event entry representing the abort by default
- **AND** the event data MUST carry the relevant `turnId`

#### Scenario: Normal turn completion
- **WHEN** a turn completes successfully
- **THEN** the runtime MUST NOT persist a normal `turn.done` event by default

### Requirement: State Persistence
Agent state MUST be JSON-serializable by default and persisted as state entries when updated through the state manager.

#### Scenario: State update
- **WHEN** a caller updates agent state through the state manager
- **THEN** the runtime MUST append a state entry representing the new state snapshot
- **AND** it MUST NOT require a turn id for that state entry

#### Scenario: Runtime resource exclusion
- **WHEN** the agent has a `LanguageModel` resource
- **THEN** that runtime object MUST NOT be persisted as a required state field
