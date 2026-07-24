## ADDED Requirements

### Requirement: Default Runtime Memory Isolation

MemOS runtime tools MUST isolate memories by trusted runtime-derived scope by default. Automatic scope MUST use a channel subject for shared channels and a direct-user subject for direct channels, while preserving the existing MemOS-owned identity derivation.

#### Scenario: Shared channel uses automatic memory scope
- **WHEN** `memoryScope` uses its automatic default and a memory tool runs in a shared channel
- **THEN** the plugin MUST derive a channel-scoped subject identity
- **AND** another shared channel MUST NOT retrieve those memories solely because it uses the same active persona

#### Scenario: Direct channel uses automatic memory scope
- **WHEN** `memoryScope` uses its automatic default and a memory tool runs in a direct channel
- **THEN** the plugin MUST derive a direct-user subject identity
- **AND** shared-channel searches MUST NOT retrieve that private memory by default

### Requirement: Supported Memory Operation Disclosure

The first MemOS Cloud integration MUST describe only `search_message` and `add_message` as available memory operations. Its prompt MUST NOT claim persistent correction, deletion, inspection, versioning, or rollback capabilities that the plugin does not expose.

#### Scenario: User asks MemOS plugin to delete memory
- **WHEN** the active MemOS tool set contains no delete operation
- **THEN** the subject MUST not claim that it deleted or can delete the memory
- **AND** it MAY explain that the current memory plugin does not provide that operation

### Requirement: Model-Bounded Memory Scope

The MemOS Agent plugin MUST NOT expose a tool whose model-provided arguments select a raw platform channel, user, or wider memory scope. The first implementation MUST remove `debug_search_channel_memory` and its `enableDebugTools` configuration.

#### Scenario: Model inspects the MemOS tool registry
- **WHEN** the MemOS Agent plugin initializes
- **THEN** the visible tool registry MUST contain scoped `search_message` and `add_message`
- **AND** it MUST NOT contain a cross-channel debug search tool

### Requirement: Explicit MemOS Tool Outcomes

MemOS tools MUST return discriminated outcomes that distinguish completed search, persisted writes, accepted asynchronous work, and failures.

#### Scenario: Synchronous memory write completes
- **WHEN** `add_message` completes with asynchronous mode disabled
- **THEN** it MUST return `outcome: "persisted"`

#### Scenario: Asynchronous memory write is accepted
- **WHEN** `add_message` is accepted with asynchronous mode enabled
- **THEN** it MUST return `outcome: "accepted"`
- **AND** the subject MUST NOT claim that the memory is searchable

#### Scenario: Memory write fails
- **WHEN** `add_message` catches a sanitized backend failure
- **THEN** it MUST return `outcome: "failed"` with the error

#### Scenario: Memory search completes or fails
- **WHEN** `search_message` completes successfully
- **THEN** it MUST return `outcome: "completed"` with its memories
- **AND** a sanitized backend failure MUST return `outcome: "failed"` with an empty memory list and the error

## MODIFIED Requirements

### Requirement: Memory Prompt Policy

The MemOS client Agent plugin MUST provide the approved cache-stable long-term memory policy from `design.md` during Agent plugin initialization. The runtime MUST reuse identical policy content for the ChannelRuntime cache lifecycle. The policy MUST describe relevant search, selective autonomous writes, supported-operation limits, scoped-memory trust, explicit `persisted`/`accepted`/`failed` write outcomes, and terminal completion.

#### Scenario: Prompt instructs search-before-answer
- **WHEN** the MemOS Agent plugin initializes
- **THEN** its policy MUST instruct the model to call `search_message` when relevant long-term memory may help
- **AND** it MUST instruct the model to use only memories that are relevant, same-subject, within the current authorized scope, and not contradicted by current input

#### Scenario: Same-context imported memory use
- **WHEN** the plugin initializes its stable policy
- **THEN** the policy MUST instruct the model to use imported historical memories only when they are relevant, same-context, same-subject, and not contradicted by the current message
- **AND** it MUST instruct the model not to generalize one group member's statement into a global user fact

#### Scenario: Sensitive or uncertain memory
- **WHEN** retrieved memory appears sensitive, uncertain, stale, or about another person
- **THEN** the policy MUST instruct the model to avoid relying on it unless current context makes that use appropriate

#### Scenario: Prompt instructs selective autonomous write
- **WHEN** the plugin initializes its stable policy
- **THEN** the policy MUST permit `add_message` without a separate permission request for new stable facts, durable preferences, project background, or long-term useful group information
- **AND** it MUST prohibit writes for transient requests, duplicates, secrets, credentials, payment data, unnecessary sensitive personal data, or short-lived emotions

#### Scenario: Prompt describes operation limits
- **WHEN** the plugin initializes its stable policy
- **THEN** the policy MUST describe search and add behavior without implying unsupported correction or deletion

#### Scenario: Prompt instructs terminal completion
- **WHEN** the plugin initializes its stable policy
- **THEN** the policy MUST instruct the model to call `finalize_response({})` after required memory tools when the runtime terminal tool is available

#### Scenario: Later model call uses memory policy
- **WHEN** a later model call runs in the same ChannelRuntime cache lifecycle
- **THEN** the runtime MUST reuse the frozen MemOS policy
- **AND** the plugin MUST NOT regenerate a different pre-history memory policy for that call

#### Scenario: Dynamic search result reaches the model
- **WHEN** `search_message` returns a different result in a later turn
- **THEN** that result MUST enter context as an append-only tool result
- **AND** it MUST NOT replace a memory system block before historical messages
