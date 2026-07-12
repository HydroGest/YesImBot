## ADDED Requirements

### Requirement: Minimal Storage Contract
The runtime MUST depend only on an `AgentStorage` interface with `append`, `read`, and `clear`.

#### Scenario: Custom storage backend
- **WHEN** a caller provides a storage backend implementing `append`, `read`, and `clear`
- **THEN** the runtime MUST be able to persist and read entries without knowing the backend format

#### Scenario: Storage does not own lifecycle
- **WHEN** the agent resets or initializes
- **THEN** lifecycle semantics MUST be handled by the agent runtime or plugins rather than by special storage constructor behavior

### Requirement: Append-Only Entry Model
Persisted runtime data MUST use `AgentEntry` records with required `id`, `type`, `data`, `timestamp`, and optional `parentId`.

#### Scenario: Message entry persistence
- **WHEN** the runtime persists a message
- **THEN** it MUST append an entry whose type identifies message data and whose data contains the `AgentMessage`

#### Scenario: Entry id and message id separation
- **WHEN** an entry contains an `AgentMessage`
- **THEN** the storage model MUST preserve both `AgentEntry.id` and `AgentMessage.meta.id` without requiring them to match

#### Scenario: Plugin custom entry
- **WHEN** a plugin declares a custom entry type
- **THEN** the runtime storage contract MUST preserve that entry without requiring core code to understand its semantics

### Requirement: Append Pipeline
The `append()` operation and pre-model `send()` message persistence MUST pass through a narrow append pipeline before entries are stored.

#### Scenario: Append hook transforms entries
- **WHEN** an append hook returns transformed entries
- **THEN** the runtime MUST persist the transformed entries instead of the original pending entries

#### Scenario: Append hook does not trigger model hooks
- **WHEN** a caller invokes `append()`
- **THEN** the runtime MUST NOT invoke system prompt extension, tool extension, tool-call hooks, or turn-finish hooks

### Requirement: Pre-Model Persistence
Submitted messages for `send()` and `run()` MUST be persisted before model execution begins.

#### Scenario: Model request fails after submitted message
- **WHEN** a model request fails after a submitted message has been accepted
- **THEN** the submitted message MUST remain in storage and the turn result MUST indicate failure

### Requirement: Step Output Persistence
Complete assistant messages and tool results MUST be persisted as entries when each step completes.

#### Scenario: Assistant output persisted
- **WHEN** an assistant message completes during a turn
- **THEN** storage MUST receive a message entry containing that assistant message with the turn id in message metadata

#### Scenario: Tool result persisted
- **WHEN** a tool result completes during a turn
- **THEN** storage MUST receive a message or tool-result entry that preserves the result with the turn id in metadata

#### Scenario: Delta omitted from storage
- **WHEN** a streaming delta is emitted during a turn
- **THEN** storage MUST NOT receive a delta entry by default

### Requirement: Agent Event Persistence Policy
The runtime MUST default to persisting only abnormal terminal agent events.

#### Scenario: Failed turn persistence
- **WHEN** a turn fails
- **THEN** the runtime MUST persist an agent event entry representing the failure by default

#### Scenario: Normal turn completion
- **WHEN** a turn completes successfully
- **THEN** the runtime MUST NOT persist a normal `turn.done` event by default

### Requirement: State Persistence
Agent state MUST be JSON-serializable by default and persisted as state entries when updated through the state manager.

#### Scenario: State update
- **WHEN** a caller updates agent state through the state manager
- **THEN** the runtime MUST append a state entry representing the new state snapshot

#### Scenario: Runtime resource exclusion
- **WHEN** the agent has a `LanguageModel` resource
- **THEN** that runtime object MUST NOT be persisted as a required state field

### Requirement: Session Outside Core
Session manager behavior MUST be implemented outside runtime core as a plugin or storage adapter.

#### Scenario: Linear session adapter
- **WHEN** a session adapter is used
- **THEN** it MUST expose storage compatible with `AgentStorage` and MUST NOT require runtime core to know session-specific operations

#### Scenario: Branch behavior omitted
- **WHEN** first-version session behavior is designed
- **THEN** branch, fork, checkout, and rebase behavior MUST remain out of scope unless introduced by a separate plugin or future capability

### Requirement: No Legacy Data Compatibility
The new runtime MUST NOT be required to read, migrate, or convert existing `packages/agent` session data.

#### Scenario: Old JSONL session data exists
- **WHEN** existing `packages/agent` JSONL or session files are present
- **THEN** the new runtime MUST NOT treat those files as supported input unless a separate future migration capability is proposed

#### Scenario: No conversion script
- **WHEN** the new runtime package is introduced
- **THEN** it MUST NOT include a required conversion script for old session data

### Requirement: Compact As Plugin
Compaction MUST be modeled as plugin behavior using custom entries and message transforms rather than as a runtime core feature.

#### Scenario: Compact entry creation
- **WHEN** a compact plugin summarizes history
- **THEN** it MUST persist a custom compact entry rather than relying on a core compact entry type

#### Scenario: Compact summary model visibility
- **WHEN** compacted history is included in a model request
- **THEN** the compact plugin MUST create or convert appropriate custom messages through transform and `toModelMessages` hooks
