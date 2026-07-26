## ADDED Requirements

### Requirement: Output Control Language Grammar

Assistant output MUST be interpreted as an Output Control Language (OCL) stream that mixes reader-visible content with host-owned control elements expressed in Koishi element syntax. Core MUST recognize exactly four control elements: `<inner_thought>…</inner_thought>`, `<sep/>`, `<sleep ms="N"/>`, and `<skip/>`. Core MUST NOT allow a persona, plugin, tool result, memory, or user message to define, redefine, extend, or disable a control element.

#### Scenario: Assistant output contains no control element
- **WHEN** a rendered assistant message contains no recognized control element
- **THEN** Core MUST deliver it as exactly one platform message
- **AND** the delivered content MUST equal the current single-message behaviour

#### Scenario: Unrecognized element resembling a control element
- **WHEN** assistant output contains an element that is not one of the four recognized control elements
- **THEN** Core MUST NOT interpret it as a control element
- **AND** it MUST remain part of reader-visible content

#### Scenario: Plugin attempts to register a control element
- **WHEN** a plugin or persona supplies text that declares a new control element
- **THEN** Core MUST treat that text as ordinary content
- **AND** the recognized control element set MUST remain unchanged

### Requirement: Control Element Escaping

Core MUST treat the XML entity forms `&lt;sep/&gt;`, `&lt;sleep&gt;`, `&lt;skip/&gt;`, and `&lt;inner_thought&gt;` as literal text rather than control elements, and MUST unescape them into their literal character form in delivered content.

#### Scenario: Model refers to a control element literally
- **WHEN** assistant output contains `&lt;sep/&gt;`
- **THEN** Core MUST NOT treat it as a split point
- **AND** the delivered message MUST contain the literal characters `<sep/>`

### Requirement: Protection Zones

Core MUST identify protection zones before evaluating any control element. Protection zones MUST include fenced code blocks, inline code spans, URLs, and non-control platform elements such as `<at>`, `<img>`, and `<quote>`. A control element occurring inside a protection zone MUST be preserved as literal text and MUST NOT be interpreted, removed, or used as a split point.

#### Scenario: Separator inside a fenced code block
- **WHEN** assistant output contains `<sep/>` inside a fenced code block
- **THEN** Core MUST NOT split at that position
- **AND** the fenced code block MUST be delivered intact with the literal text preserved

#### Scenario: Separator inside inline code
- **WHEN** assistant output contains `<sep/>` inside an inline code span
- **THEN** Core MUST NOT split at that position
- **AND** the literal text MUST remain in the delivered content

#### Scenario: Separator inside a URL
- **WHEN** a split point would fall inside a URL
- **THEN** Core MUST NOT split at that position
- **AND** the URL MUST be delivered as one contiguous string

#### Scenario: Platform element spanning a split point
- **WHEN** a split point would fall inside an `<at>` or `<img>` element
- **THEN** Core MUST NOT split at that position
- **AND** the element MUST be delivered intact within one message

### Requirement: Ordered Parsing Algorithm

Core MUST parse a complete assistant message in this fixed order: identify protection zones, extract `<inner_thought>` regions, evaluate `<skip/>`, split on `<sep/>`, resolve `<sleep>` hints per segment, apply guardrails, then assert no residual control element survives. Core MUST NOT reorder these stages, and MUST NOT split before protection zones are known.

#### Scenario: Parsing begins
- **WHEN** Core parses an assistant message
- **THEN** it MUST compute protection zones before evaluating any split point

#### Scenario: All stages apply to one message
- **WHEN** an assistant message contains inner thought, separators, and sleep hints together
- **THEN** Core MUST apply every stage in the required order
- **AND** the resulting segments MUST contain no control element

### Requirement: Private Inner Thought Handling

Core MUST remove every `<inner_thought>` region from delivered content and MUST NOT deliver its text to any reader. Core MUST retain the raw assistant output including inner-thought text in channel JSONL, and MUST replay it unchanged to the model as the model's own history. Inner-thought text MUST NOT contribute to typing-delay computation.

#### Scenario: Reply contains an inner thought
- **WHEN** assistant output contains an `<inner_thought>` region
- **THEN** no delivered message MUST contain any part of that region
- **AND** the stored JSONL entry MUST retain the region verbatim

#### Scenario: History is projected to the model
- **WHEN** Core projects channel history for a later turn
- **THEN** stored inner-thought text MUST be replayed unchanged
- **AND** Core MUST NOT rewrite, summarize, or strip it from the projection

#### Scenario: Inner thought precedes visible content
- **WHEN** an inner-thought region appears before the first visible segment
- **THEN** the first segment's typing delay MUST derive only from visible characters

### Requirement: Segment Splitting Authority

The model MUST own segment count, split position, and segment length. Core MUST NOT split content the model did not mark, MUST NOT merge marked segments to reach a target count, and MUST NOT apply randomness to segment structure. Core MUST NOT define a preferred or target number of segments.

#### Scenario: Model marks three split points
- **WHEN** assistant output contains three separators outside protection zones
- **THEN** Core MUST produce four segments in original order
- **AND** Core MUST NOT merge them toward any target count

#### Scenario: Model marks no split point in a long reply
- **WHEN** a long assistant message contains no separator
- **THEN** Core MUST deliver it as one message
- **AND** Core MUST NOT split it by punctuation, length, or sentence boundary

#### Scenario: Identical output parsed twice
- **WHEN** Core parses the same assistant output twice
- **THEN** the resulting segment boundaries MUST be identical

### Requirement: Segment Normalization

Core MUST trim leading and trailing whitespace from each segment and MUST discard segments that contain no content after trimming. Core MUST collapse consecutive separators into one split point and MUST ignore separators at the start or end of the output.

#### Scenario: Consecutive separators
- **WHEN** assistant output contains two adjacent separators
- **THEN** Core MUST treat them as one split point
- **AND** Core MUST NOT emit an empty message

#### Scenario: Whitespace-only segment
- **WHEN** a segment contains only whitespace after trimming
- **THEN** Core MUST discard that segment
- **AND** Core MUST NOT deliver a blank message

#### Scenario: Leading and trailing separators
- **WHEN** the output begins or ends with a separator
- **THEN** Core MUST ignore it
- **AND** the segment count MUST NOT include an empty leading or trailing segment

### Requirement: Turn Skip Element

When `<skip/>` occurs outside a protection zone, Core MUST deliver zero messages for that turn, MUST discard all visible content from that output, and MUST persist the raw output including any accompanying inner thought. Core MUST NOT treat a skipped turn as a delivery failure.

#### Scenario: Model declines to reply
- **WHEN** assistant output contains `<skip/>` outside a protection zone
- **THEN** Core MUST deliver no message for that turn
- **AND** Core MUST persist the raw output including the skip element

#### Scenario: Skip accompanied by visible text
- **WHEN** assistant output contains both `<skip/>` and visible content
- **THEN** Core MUST discard the visible content
- **AND** Core MUST NOT deliver any part of it

#### Scenario: Skip is recorded rather than failed
- **WHEN** a turn produces only a skip decision
- **THEN** Core MUST NOT emit a delivery-failure record
- **AND** the turn status MUST remain successful

### Requirement: Guardrails And Safe Degradation

Core MUST enforce a maximum segment count, a per-segment delay ceiling, and a total delivery time ceiling as safety limits. When parsing, validation, or the residual-element assertion fails, Core MUST degrade to one complete message containing the reply with all control elements removed. Core MUST NOT lose a reply because of a parsing or validation failure.

#### Scenario: Segment count exceeds the maximum
- **WHEN** parsed segments exceed the configured maximum
- **THEN** Core MUST truncate to the maximum
- **AND** Core MUST NOT reject the reply

#### Scenario: Parsing fails
- **WHEN** parsing raises an error
- **THEN** Core MUST deliver the reply as one message with control elements removed
- **AND** Core MUST NOT discard the reply

#### Scenario: All segments are discarded
- **WHEN** normalization leaves zero segments but the raw output contains visible content
- **THEN** Core MUST deliver that visible content as one message

#### Scenario: Guardrails are not model targets
- **WHEN** Core composes model instructions for output shape
- **THEN** it MUST NOT present the maximum segment count or delay ceilings as targets

### Requirement: No Control Element Leakage

Core MUST verify that no recognized control element and no inner-thought text survives in any segment before delivery. When verification fails, Core MUST degrade the whole reply to one sanitized message rather than deliver the offending segment.

#### Scenario: Residual control element detected
- **WHEN** a prepared segment still contains a recognized control element
- **THEN** Core MUST NOT deliver that segment
- **AND** Core MUST degrade the reply to one sanitized message

#### Scenario: Reader-visible output is verified
- **WHEN** Core delivers any segment
- **THEN** that segment MUST contain no control element and no inner-thought text

### Requirement: Parsing Applies Only To Current Assistant Output

Core MUST apply OCL parsing only to the assistant output of the current turn. Core MUST NOT parse control elements from user messages, event records, tool results, memory content, or projected history.

#### Scenario: User message contains a control element
- **WHEN** an inbound user message contains `<sep/>`
- **THEN** Core MUST NOT interpret it as a control element
- **AND** it MUST NOT affect delivery of any reply

#### Scenario: History contains stored control elements
- **WHEN** Core projects stored assistant output containing control elements
- **THEN** Core MUST NOT re-parse or re-execute them
