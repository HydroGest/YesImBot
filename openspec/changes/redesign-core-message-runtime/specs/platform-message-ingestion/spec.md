## MODIFIED Requirements

### Requirement: Incompatible Element-Based Platform Message

Core MUST represent each eligible inbound message during collection and preparation as a versionless pure-data `Platform.Message` whose working content is a Koishi `Element[]` tree plus stable metadata. The shape MUST retain source, channel scope, required channel type (`private` or `group`), sender identity, original platform message ID, receipt time, optional platform timestamp, and `elements`. Core MUST capture channel type from the real Koishi Session while drafting the message and MUST NOT reconstruct or spread a Session-shaped object to preserve that fact. It MUST NOT retain legacy data, a version field, an extensions map, raw Session/Bot/native payload, generic references/readers/snapshots, semantic BodyPart/MessagePart/MessageView types, plain-text duplicates as a second working-content truth, or rendered-presentation cache. Core MUST use Koishi `Element` directly and MUST NOT introduce a parallel public element algebra or hand-written pseudo-elements. Core MUST NOT runtime-schema-validate the platform message.

At the persistence boundary, core MUST encode sealed elements into `Platform.MessageRecord` with the same stable metadata, including channel type, and literal `content: string`. The runtime domain object and persisted record MUST remain distinct; persisted custom-message data MUST NOT use `Element[]` as its storage encoding.

#### Scenario: Direct Session uses an accessor

- **WHEN** an eligible message arrives through a Koishi Session whose directness is exposed by an accessor or another non-enumerable property
- **THEN** core MUST read that fact from the real Session while drafting the platform message
- **AND** the resulting message scope MUST contain `channelType: "private"`

#### Scenario: Canonical message drives downstream routing

- **WHEN** collection and adapter refinement produce a `Platform.Message`
- **THEN** core MUST derive self-message, mention, runtime scope, Agent context, and persistence behavior from that message
- **AND** it MUST NOT re-read sender, scope, content, or channel type from a reconstructed Session

#### Scenario: Eligible message is persisted

- **WHEN** a non-self message is admitted by core routing and preparation completes
- **THEN** core MUST persist a `Platform.MessageRecord` whose literal `content` is derived from normalized and sealed `elements`
- **AND** the record MUST preserve the canonical channel type
- **AND** it MUST NOT persist a legacy compatibility representation or generic presentation model

#### Scenario: Legacy record is encountered

- **WHEN** storage contains a platform-message record without the required channel type or in another legacy shape
- **THEN** the new framework MUST NOT decode, render, infer, or migrate that record at runtime
- **AND** deployment documentation MUST require prior history removal or one-time replacement
