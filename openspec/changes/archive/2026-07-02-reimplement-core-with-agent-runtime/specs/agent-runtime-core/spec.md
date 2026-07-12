## ADDED Requirements

### Requirement: Turn Interruption API
The runtime MUST expose an `interrupt()` operation that aborts the active turn without clearing storage or stopping the runtime.

#### Scenario: Interrupt active turn
- **WHEN** a caller invokes `interrupt()` while a turn is active
- **THEN** the runtime MUST attempt to abort the active model call and tool execution
- **AND** it MUST settle that turn with a `TurnResult` whose status is `aborted`

#### Scenario: Wait interrupted turn
- **WHEN** a caller waits for a turn that was interrupted
- **THEN** `waitTurn(turnId)` MUST resolve a retained `TurnResult` with status `aborted`
- **AND** it MUST NOT reject solely because the turn was interrupted

#### Scenario: Interrupt without active turn
- **WHEN** a caller invokes `interrupt()` and no turn is active
- **THEN** the runtime MUST complete without error

#### Scenario: Interruption preserves history
- **WHEN** a turn is interrupted after messages or tool results have already been persisted
- **THEN** the runtime MUST NOT roll back those persisted entries
- **AND** it MUST persist or emit the aborted terminal event according to runtime event persistence rules

#### Scenario: Runtime remains usable after interrupt
- **WHEN** `interrupt()` completes
- **THEN** the runtime MUST remain initialized and able to accept later `append()`, `send()`, `run()`, and `waitTurn()` operations

### Requirement: Active Turn Observation Visibility
The runtime MUST make messages appended during an active turn visible to that turn at the next safe model boundary without treating those messages as joined explicit input.

#### Scenario: Append observation during active turn
- **WHEN** a caller invokes `append(message)` while a turn is active
- **THEN** the runtime MUST persist the message through the append pipeline
- **AND** the append operation MUST NOT create a new top-level turn

#### Scenario: Observation reaches next safe model boundary
- **WHEN** an appended observation is persisted during an active turn before a later model request is prepared for that same turn
- **THEN** the runtime MUST include that observation in the model context for the later model request

#### Scenario: Observation preserves append order
- **WHEN** appended observations, assistant messages, and tool results are persisted during the same active turn
- **THEN** the runtime MUST preserve append-only storage order when constructing later model context
- **AND** it MUST NOT reorder those messages by timestamp

#### Scenario: Observation differs from join
- **WHEN** a message is appended during an active turn
- **THEN** the runtime MUST NOT treat it as a joined current input message
- **AND** it MUST NOT force another model request solely because the message was appended

#### Scenario: Joined input remains explicit
- **WHEN** a caller sends a message with `ifBusy: "join"` during an active turn
- **THEN** the runtime MUST continue to treat that message as explicit joined input for the active turn
