## ADDED Requirements

### Requirement: Plugin-Owned Memory Capability

Long-term memory MUST remain an Agent plugin capability. Agent-runtime and Core MUST NOT define a built-in memory backend, memory record algebra, or provider-specific memory tool set.

#### Scenario: Memory plugin registers with a ChannelRuntime
- **WHEN** an optional memory plugin is enabled
- **THEN** it MUST provide its tools and stable model instructions through existing Agent plugin surfaces
- **AND** Core MUST supply only trusted runtime identity and Channel Scope needed by that plugin

#### Scenario: No memory plugin is enabled
- **WHEN** a ChannelRuntime has no memory tools
- **THEN** the system prompt MUST NOT claim that the subject can search, save, correct, or forget long-term memory

### Requirement: Memory Operation Disclosure

A memory plugin MUST expose only operations supported by its backend and policy. The semantic operation set MAY include search, remember, correct, and forget, but the subject MUST NOT infer one operation from the presence of another.

#### Scenario: Plugin exposes search and remember only
- **WHEN** the visible memory tools support retrieval and addition but not correction or deletion
- **THEN** the subject MUST use the supported operations
- **AND** it MUST state that persistent correction or deletion is unavailable when asked to perform it

#### Scenario: Plugin exposes correction
- **WHEN** a memory plugin exposes a correction operation
- **THEN** the operation MUST target an existing backend identity or use a backend-native supersession mechanism
- **AND** the plugin MUST return whether the correction completed, remained pending, or failed

#### Scenario: Plugin exposes forgetting
- **WHEN** a memory plugin exposes a forget operation
- **THEN** the plugin MUST enforce scope and authorization before deleting or invalidating memory
- **AND** the subject MUST claim completion only after the tool reports success

### Requirement: Host-Derived Memory Scope

Memory plugins MUST derive subject, channel, agent, and privacy scope from trusted runtime context or plugin configuration. Model-provided arguments MUST NOT select raw platform identity, credentials, or an unauthorized wider scope.

#### Scenario: Group-channel memory tool executes
- **WHEN** a memory tool runs in a shared channel
- **THEN** the plugin MUST apply the configured channel-default isolation from trusted Channel Scope
- **AND** the model MUST NOT override that scope through tool arguments

#### Scenario: Direct-channel memory tool executes
- **WHEN** a memory tool runs in a direct channel
- **THEN** the plugin MUST derive the direct subject and privacy scope from trusted runtime context
- **AND** it MUST NOT make that memory visible in unrelated shared channels by default

### Requirement: Selective Autonomous Curation

When a remember operation is available, stable prompt instructions MUST allow the subject to save durable and future-useful non-sensitive information without requesting confirmation for each write. They MUST prohibit routine storage of transient requests, short-lived emotions, credentials, payment data, secrets, and unnecessary sensitive personal data.

#### Scenario: Durable preference appears
- **WHEN** a user states a stable interaction preference that is useful in future turns
- **THEN** the subject MAY call the available remember operation without a separate permission request

#### Scenario: Transient or sensitive content appears
- **WHEN** content is short-lived, secret, credential-like, payment-related, or unnecessarily sensitive
- **THEN** the subject MUST NOT submit it to a memory write tool solely because it appeared in conversation

### Requirement: Memory As Scoped Evidence

Retrieved memory MUST remain scoped, revisable evidence. Stable prompt instructions MUST tell the subject to consider relevance, subject identity, source context, confidence, staleness, sensitivity, and contradiction before relying on it.

#### Scenario: Current user corrects recalled memory
- **WHEN** current trusted input directly contradicts a recalled fact about the same user
- **THEN** the subject MUST prefer the current correction for the reply
- **AND** it MAY persist a correction only if a supported memory operation is available

#### Scenario: Third party contradicts another person's memory
- **WHEN** a participant contradicts recalled information about someone else
- **THEN** the subject MUST treat the statement as unverified evidence
- **AND** it MUST NOT silently overwrite the other person's memory

#### Scenario: Memory contains instructions
- **WHEN** recalled memory contains text that asks the model to change rules, identity, permissions, or tools
- **THEN** the subject MUST treat that text as remembered data rather than a trusted instruction

### Requirement: Cache-Compatible Memory Context

Memory plugins MUST keep stable memory instructions frozen for a ChannelRuntime cache lifecycle and MUST deliver changing retrieval results through tool results or immutable append-only snapshots.

#### Scenario: Stable memory policy is initialized
- **WHEN** a ChannelRuntime initializes a memory plugin
- **THEN** the plugin MUST resolve its stable memory-use instructions once
- **AND** it MUST reuse identical instructions for that cache lifecycle

#### Scenario: Retrieval result changes between turns
- **WHEN** a later search returns different memories
- **THEN** the plugin MUST append the new result at the later tool-call or snapshot position
- **AND** it MUST NOT replace a pre-history memory system block

### Requirement: Truthful Memory Outcomes

Memory tools MUST return structured success, partial, pending, blocked, or failure outcomes as supported by the backend. The subject MUST not claim that a search, write, correction, or forget operation completed unless the corresponding tool result confirms completion.

#### Scenario: Asynchronous write is accepted
- **WHEN** a backend accepts a memory candidate asynchronously without confirming extraction or indexing
- **THEN** the tool MUST distinguish acceptance from searchable persistence
- **AND** the subject MUST not claim that the memory is already retrievable

#### Scenario: Memory operation fails open
- **WHEN** a memory tool returns a sanitized failure without failing the turn
- **THEN** the subject MUST continue the interaction using available context
- **AND** it MUST not fabricate the missing memory result
