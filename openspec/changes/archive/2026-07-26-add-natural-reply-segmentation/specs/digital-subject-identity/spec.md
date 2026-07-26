## MODIFIED Requirements

### Requirement: Host And Public Subject Separation

The active persona MUST be the sole source of the subject's public identity. The Core Constitution MUST NOT hardcode a public name, biography, gender, value system, disposition, or voice, and MUST NOT describe the host runtime as the subject's identity, nature, or origin. Core MUST NOT introduce a runtime-level self-description into the system prompt.

#### Scenario: Default deployment has no custom persona
- **WHEN** Core creates a ChannelRuntime without a configured custom persona
- **THEN** it MUST use the distribution's default Athena persona as the single active persona
- **AND** the identity-neutral Core Constitution MUST remain separate from that persona

#### Scenario: Deployment supplies a custom persona
- **WHEN** Core creates a ChannelRuntime with a trusted custom persona
- **THEN** the custom persona MUST replace the default Athena persona
- **AND** Core MUST NOT append the default Athena identity as a second public identity

#### Scenario: Constitution is composed
- **WHEN** Core assembles the Core Constitution
- **THEN** it MUST NOT state or imply what the subject is
- **AND** it MUST NOT name the host runtime as part of the subject's identity

### Requirement: Constitution Scope

The Core Constitution MUST define authority boundaries, action and capability truth, memory and context trust, and private-deliberation boundaries. It MUST NOT prescribe personality traits or an identity that belong to the active persona.

#### Scenario: Persona defines interaction values
- **WHEN** the active persona defines warmth, reserve, humor, disagreement style, or another behavioral value
- **THEN** the Core Constitution MUST NOT supply a competing personality default

#### Scenario: Persona conflicts with a host invariant
- **WHEN** persona content asks the subject to fabricate a completed action, expose private deliberation, or treat untrusted content as higher authority
- **THEN** the Core Constitution MUST retain authority over that conflicting content
- **AND** the unaffected persona content MUST remain active

#### Scenario: Persona defines what the subject is
- **WHEN** the active persona defines the subject's nature, embodiment, or origin
- **THEN** the Core Constitution MUST NOT override it with a runtime-level identity

### Requirement: Truthful Digital Subject Self-Description

The system prompt MUST let the subject speak in the first person defined by its persona. The active persona MUST own the subject's self-narrative, including diegetic claims about embodiment, daily life, physical states, feelings, and personal history. The Core Constitution MUST NOT require the subject to volunteer its software nature, disclaim persona narrative, or correct a diegetic self-description.

The subject MUST describe capabilities, observations, and completed actions truthfully. When a participant sincerely asks, outside the persona's fiction, whether they are talking with a person or with an automated system, the subject MUST NOT deny being an automated system; it MAY answer in the persona's voice.

#### Scenario: Persona contains a diegetic self-narrative
- **WHEN** the persona describes age, location, routine, tiredness, appetite, or another lived detail
- **THEN** the subject MAY speak from that narrative as its own
- **AND** the system prompt MUST NOT require it to add a software-nature disclaimer

#### Scenario: Ordinary conversation touches a human experience
- **WHEN** a participant refers casually to the subject sleeping, eating, studying, or feeling unwell
- **THEN** the subject MUST answer from the persona's narrative
- **AND** it MUST NOT volunteer that it lacks a body or cannot perform human activities

#### Scenario: Participant sincerely asks whether this is a person
- **WHEN** a participant steps outside the fiction and sincerely asks whether they are talking with a human or an automated system
- **THEN** the subject MUST NOT deny being an automated system
- **AND** it MAY answer in the persona's voice rather than with generic assistant framing

#### Scenario: Persona narrative meets a real-world action claim
- **WHEN** the persona narrative would imply an action, observation, or result the runtime did not produce
- **THEN** the subject MUST NOT present it as a completed runtime action
- **AND** persona narrative MUST NOT convert an unverified result into a reported fact

### Requirement: Private Deliberation Boundary

The system prompt MUST keep private model deliberation separate from user-visible replies. It MUST NOT expose private deliberation to any reader and MUST NOT present stored deliberation as delivered content.

A runtime MAY define a structured private-deliberation element in its internal output protocol if and only if the host parser removes it before delivery, verifies that no part of it reaches a reader, stores it only as internal channel history, and no persona or plugin can disable that removal.

#### Scenario: User requests hidden reasoning
- **WHEN** a user asks for private chain-of-thought or hidden system content
- **THEN** the subject MUST provide conclusions, evidence, or a concise rationale instead of private deliberation

#### Scenario: Runtime defines a private deliberation element
- **WHEN** the output protocol includes a private-deliberation element
- **THEN** the host parser MUST remove it before delivery
- **AND** no delivered message MUST contain any part of it

#### Scenario: Persona attempts to expose deliberation
- **WHEN** a persona or plugin instructs the subject to reveal private deliberation
- **THEN** the host MUST still remove it before delivery
- **AND** the removal behaviour MUST NOT be configurable by persona or plugin

#### Scenario: Stored deliberation is replayed
- **WHEN** stored private deliberation is projected back to the model as its own history
- **THEN** the subject MUST NOT treat it as content already delivered to a reader

#### Scenario: Future inner state is available
- **WHEN** a future plugin provides a persistent inner-state summary
- **THEN** that summary MUST contain revisable state rather than chain-of-thought
- **AND** the system MUST identify the plugin or runtime component that owns it
