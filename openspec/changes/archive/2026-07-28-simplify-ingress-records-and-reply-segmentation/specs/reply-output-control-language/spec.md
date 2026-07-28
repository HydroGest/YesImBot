## MODIFIED Requirements

### Requirement: Output Control Language Grammar
Assistant output MUST be interpreted as a host-owned reply control stream that
mixes reader-visible content with control elements expressed in Koishi element
syntax. Core MUST recognize exactly two control elements: `<inner_thought>…</inner_thought>`
and `<sep/>`. Core MUST NOT allow a persona, plugin, tool result, memory, or
user message to define, redefine, extend, or disable a control element.

#### Scenario: Assistant output contains no control element
- **WHEN** a rendered assistant message contains no recognized control element
- **THEN** Core MUST deliver it as exactly one platform message
- **AND** the delivered content MUST equal the current single-message behaviour

#### Scenario: Unrecognized element resembling a control element
- **WHEN** assistant output contains an element that is not one of the two
  recognized control elements
- **THEN** Core MUST NOT interpret it as a control element
- **AND** it MUST remain part of reader-visible content

### Requirement: Control Element Escaping
Core MUST treat the XML entity forms `&lt;sep/&gt;` and `&lt;inner_thought&gt;` as
literal text rather than control elements, and MUST unescape them into their
literal character form in delivered content.

#### Scenario: Model refers to a control element literally
- **WHEN** assistant output contains `&lt;sep/&gt;`
- **THEN** Core MUST NOT treat it as a split point
- **AND** the delivered message MUST contain the literal characters `<sep/>`

### Requirement: Ordered Parsing Algorithm
Core MUST parse a complete assistant message in this fixed order: identify any
required literal-text protection handling, extract `<inner_thought>` regions,
split on `<sep/>`, normalize visible segments, apply guardrails, then assert no
residual recognized control element survives. Core MUST NOT reorder these stages.

#### Scenario: Parsing begins
- **WHEN** Core parses an assistant message
- **THEN** it MUST complete inner-thought extraction before evaluating visible
  segment output

#### Scenario: Message contains inner thought and separators
- **WHEN** an assistant message contains both `<inner_thought>` and `<sep/>`
- **THEN** Core MUST apply every stage in the required order
- **AND** the resulting visible segments MUST contain neither recognized control
  element nor private-deliberation text

### Requirement: Private Inner Thought Handling
Core MUST remove every `<inner_thought>` region from delivered content and MUST
NOT deliver its text to any reader. Core MUST retain the raw assistant output
including inner-thought text in channel JSONL, and MUST replay it unchanged to
the model as the model's own history.

#### Scenario: Reply contains an inner thought
- **WHEN** assistant output contains an `<inner_thought>` region
- **THEN** no delivered message MUST contain any part of that region
- **AND** the stored JSONL entry MUST retain the region verbatim

#### Scenario: History is projected to the model
- **WHEN** Core projects channel history for a later turn
- **THEN** stored inner-thought text MUST be replayed unchanged
- **AND** Core MUST NOT rewrite, summarize, or strip it from the projection

### Requirement: Segment Splitting Authority
The model MUST own segment count, split position, and segment length through
explicit `<sep/>` markers. Core MUST NOT split content the model did not mark,
MUST NOT merge marked segments to reach a target count, and MUST NOT define a
preferred or target number of segments.

#### Scenario: Model marks three split points
- **WHEN** assistant output contains three separators outside literal-text
  protection
- **THEN** Core MUST produce four segments in original order
- **AND** Core MUST NOT merge them toward any target count

#### Scenario: Model marks no split point in a long reply
- **WHEN** a long assistant message contains no separator
- **THEN** Core MUST deliver it as one message
- **AND** Core MUST NOT split it by punctuation, length, or sentence boundary

### Requirement: Segment Normalization
Core MUST trim leading and trailing whitespace from each segment and MUST discard
segments that contain no content after trimming. Core MUST collapse consecutive
separators into one split point and MUST ignore separators at the start or end of
the output.

#### Scenario: Consecutive separators
- **WHEN** assistant output contains two adjacent separators
- **THEN** Core MUST treat them as one split point
- **AND** Core MUST NOT emit an empty message

#### Scenario: Leading and trailing separators
- **WHEN** the output begins or ends with a separator
- **THEN** Core MUST ignore it
- **AND** the segment count MUST NOT include an empty leading or trailing segment

### Requirement: Guardrails And Safe Degradation
Core MUST enforce a maximum segment count as a safety limit. When parsing,
validation, or residual-element assertion fails, Core MUST degrade to one
complete message containing the reply with recognized control elements removed.
Core MUST NOT lose a reply because of a parsing or validation failure.

#### Scenario: Segment count exceeds the maximum
- **WHEN** parsed segments exceed the configured maximum
- **THEN** Core MUST truncate to the maximum or degrade to one sanitized message
- **AND** it MUST NOT merge marked segments to satisfy the guardrail

#### Scenario: Parsing fails
- **WHEN** parsing raises an error
- **THEN** Core MUST deliver the reply as one message with recognized control
  elements removed
- **AND** Core MUST NOT discard the reply

### Requirement: No Control Element Leakage
Core MUST verify that no recognized control element and no inner-thought text
survives in any segment before delivery. When verification fails, Core MUST
degrade the whole reply to one sanitized message rather than deliver the
offending segment.

#### Scenario: Residual control element detected
- **WHEN** a prepared segment still contains a recognized control element
- **THEN** Core MUST NOT deliver that segment
- **AND** Core MUST degrade the reply to one sanitized message

#### Scenario: Reader-visible output is verified
- **WHEN** Core delivers any segment
- **THEN** that segment MUST contain no recognized control element and no
  inner-thought text

## REMOVED Requirements

### Requirement: Turn Skip Element

**Reason**: The approved design no longer wants a model-authored skip protocol.
Silence remains a host-owned behavior, but it is no longer expressed through a
reply control element.

**Migration**: Remove `<skip/>` from prompt instructions, parser logic, and
tests. Code that previously expected skip semantics must rely on ordinary host
decision paths or produce no visible reply without a dedicated reply-control tag.
