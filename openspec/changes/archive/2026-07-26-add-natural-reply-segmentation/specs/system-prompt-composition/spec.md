## MODIFIED Requirements

### Requirement: Ordered Stable Prompt Segments

Each ChannelRuntime MUST construct its stable system input in this order: immutable Core Constitution, operator policy, active persona, stable runtime context, and stable plugin instructions. Native tool definitions MUST remain separate from system prose and MUST use deterministic ordering.

The Core Constitution MUST own the output control protocol that governs reply shape, private deliberation, pacing, and declining to reply. Operator policy, persona, and plugin instructions MUST NOT define, redefine, or disable any part of that protocol.

#### Scenario: ChannelRuntime builds its first model request
- **WHEN** Core initializes a ChannelRuntime
- **THEN** it MUST resolve each stable prompt source once in the required order
- **AND** later plugins MUST NOT delete, replace, or reorder an earlier segment

#### Scenario: Plugin describes a tool capability
- **WHEN** a plugin provides stable model instructions for its tools
- **THEN** those instructions MUST follow the active persona as stable plugin instructions
- **AND** tool names and schemas MUST remain in the native tool input

#### Scenario: Persona describes reply style
- **WHEN** a persona describes habits of expression or thought
- **THEN** those descriptions MUST NOT define or override a control element
- **AND** the Constitution's output control protocol MUST retain authority

#### Scenario: Plugin attempts to change output protocol
- **WHEN** a plugin's stable instructions attempt to redefine reply shape control
- **THEN** the Constitution's protocol MUST remain in effect unchanged

## ADDED Requirements

### Requirement: Output Shape Instruction Without Fixed Targets

The Core Constitution's output control instruction MUST direct the model to decide reply meaning before reply shape, MUST present a single message as a normal and frequent outcome, and MUST require every split point to be evaluated from the reader's sequential view. It MUST NOT state a target message count, a target segment length, a punctuation ratio, or a required rhythm, and MUST NOT expose runtime guardrail values as targets.

#### Scenario: Instruction describes segmentation
- **WHEN** the Constitution instructs the model on reply shape
- **THEN** it MUST NOT contain a fixed message count, length, or punctuation quota
- **AND** it MUST state that one message is a normal outcome

#### Scenario: Instruction addresses sequential reading
- **WHEN** the Constitution instructs the model on split points
- **THEN** it MUST require that a partial reply left standing alone is harmless
- **AND** it MUST require integrity for facts, instructions, code, links, structured content, and quoted text

#### Scenario: Instruction addresses pattern repetition
- **WHEN** the Constitution instructs the model on variation
- **THEN** it MUST direct the model away from repeating a recent shape
- **AND** it MUST NOT authorize degraded writing, deliberate misspellings, or scattered punctuation as variation

#### Scenario: Guardrail values stay internal
- **WHEN** Core enforces a maximum segment count or delay ceiling
- **THEN** the Constitution MUST NOT present those values to the model

### Requirement: Constitution Version Two Cache Lifecycle

Raising the Core Constitution to version 2 MUST start a new cache lifecycle for every ChannelRuntime. Core MUST drain and replace each ChannelRuntime rather than mutating a running one, and MUST NOT retain a prompt prefix built from version 1.

#### Scenario: Constitution version changes
- **WHEN** the Core Constitution version changes from 1 to 2
- **THEN** Core MUST drain and replace every ChannelRuntime
- **AND** it MUST NOT reuse a version 1 prompt prefix

#### Scenario: Rollback to version one
- **WHEN** the Constitution is reverted to version 1
- **THEN** Core MUST start a new cache lifecycle again
- **AND** output without control elements MUST deliver as one message
