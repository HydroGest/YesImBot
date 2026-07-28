## MODIFIED Requirements

### Requirement: Output Control Language Grammar
Assistant output MUST be interpreted as a Koishi element stream parsed by `h.parse()`.
Core MUST recognize exactly three control elements: `<inner_thought>…</inner_thought>`,
`<sep/>`, and `<raw>…</raw>`. Core MUST NOT allow a persona, plugin, tool result,
memory, or user message to define, redefine, extend, or disable a control element.

#### Scenario: Assistant output contains no control element
- **WHEN** a rendered assistant message contains no recognized control element
- **THEN** Core MUST deliver it as exactly one platform message

#### Scenario: Assistant output contains a platform element
- **WHEN** assistant output contains a platform element such as `<at>` or `<img>`
- **THEN** Core MUST preserve it as a structured element in the delivered segment
- **AND** it MUST NOT be flattened into literal text

#### Scenario: Plugin attempts to register a control element
- **WHEN** a plugin or persona supplies text that declares a new control element
- **THEN** Core MUST treat that text as ordinary content
- **AND** the recognized control element set MUST remain unchanged

### Requirement: Ordered Parsing Algorithm
Core MUST parse a complete assistant message in this fixed order: extract every
`<raw>` region from the source string before any element parsing, parse the
remaining source with `h.parse()`, discard `<inner_thought>` subtrees, partition
the tree on `<sep/>` into ordered segments, then restore extracted `<raw>` content
into text nodes. Core MUST NOT reorder these stages, and MUST NOT parse `<raw>`
content as elements at any stage.

#### Scenario: Raw extraction precedes element parsing
- **WHEN** Core parses an assistant message containing a `<raw>` region
- **THEN** the raw substring MUST be captured before `h.parse()` is invoked
- **AND** the captured substring MUST be restored byte-for-byte into the segment

#### Scenario: Message contains inner thought and separators
- **WHEN** an assistant message contains both `<inner_thought>` and `<sep/>`
- **THEN** Core MUST apply every stage in the required order
- **AND** the resulting segments MUST contain neither recognized control element
  nor private-deliberation content

#### Scenario: Raw placeholder cannot be forged
- **WHEN** assistant output contains text resembling Core's internal raw placeholder
- **THEN** Core MUST NOT substitute captured raw content at that position
- **AND** the text MUST be delivered as ordinary content

### Requirement: Private Inner Thought Handling
Core MUST remove every `<inner_thought>` subtree from delivered content and MUST
NOT deliver its content to any reader. Core MUST NOT expose inner-thought content
as a parser output field. Core MUST retain the raw assistant output including
inner-thought content in channel JSONL, and MUST replay it unchanged to the model
as the model's own history.

#### Scenario: Reply contains an inner thought
- **WHEN** assistant output contains an `<inner_thought>` region
- **THEN** no delivered message MUST contain any part of that region
- **AND** the stored JSONL entry MUST retain the region verbatim

#### Scenario: History is projected to the model
- **WHEN** Core projects channel history for a later turn
- **THEN** the assistant message MUST be replayed including its inner thought

### Requirement: Segment Splitting Authority
The model MUST own every visible split position through `<sep/>`. Core MUST NOT
create an unmarked split and MUST NOT merge marked segments. Core MUST discard
segments that are empty after trimming.

#### Scenario: Leading, trailing, or consecutive separators
- **WHEN** assistant output contains leading, trailing, or consecutive `<sep/>`
- **THEN** Core MUST produce no empty segment

#### Scenario: Long output without a separator
- **WHEN** assistant output is long and contains no `<sep/>`
- **THEN** Core MUST deliver exactly one message
- **AND** Core MUST NOT split on punctuation or length

### Requirement: No Control Element Leakage
Core MUST verify that no recognized control element survives as a *control element*
in any segment before delivery, and that no inner-thought content survives in any
form. Literal control-element text restored from a `<raw>` region MUST be permitted
as reader-visible content. When a control element survives as an element, Core MUST
remove it and deliver the remaining content rather than discard the reply.

#### Scenario: Reader-visible output is verified
- **WHEN** Core delivers any segment
- **THEN** that segment MUST contain no `<sep/>` or `<inner_thought>` element
- **AND** it MUST contain no inner-thought content

#### Scenario: Literal control text from a raw region
- **WHEN** a segment contains the literal text `<sep/>` restored from `<raw>`
- **THEN** Core MUST deliver it as ordinary visible content
- **AND** Core MUST NOT treat it as leakage

## ADDED Requirements

### Requirement: Verbatim Raw Content
Core MUST treat the content of a `<raw>…</raw>` region as verbatim plain text.
Core MUST NOT parse it as elements, MUST NOT unescape entities inside it, and MUST
deliver it byte-for-byte as it appeared in the assistant output.

#### Scenario: Raw content contains markup-like text
- **WHEN** assistant output contains `<raw>List<String> generic</raw>`
- **THEN** the delivered message MUST contain the literal text `List<String> generic`
- **AND** no `String` element MUST appear in the delivered segment

#### Scenario: Raw content contains a code fence
- **WHEN** assistant output contains a fenced code block inside `<raw>`
- **THEN** the code block MUST be delivered intact including every `<` character

#### Scenario: Raw content contains a control element
- **WHEN** assistant output contains `<raw>` content that includes `<sep/>`
- **THEN** Core MUST NOT split at that position
- **AND** the literal text `<sep/>` MUST be delivered

#### Scenario: Raw region is unterminated
- **WHEN** assistant output contains `<raw>` with no matching `</raw>`
- **THEN** Core MUST deliver the reply without dropping content

### Requirement: No Element Whitelist On Delivery
Core MUST deliver every parsed non-control element as a structured element without
consulting an allowed-element set. Core MUST NOT filter, reconstruct, or warn about
an element merely because Core does not recognize its type, and MUST NOT maintain a
runtime registry of recognized element types.

#### Scenario: Segment contains an element Core does not know
- **WHEN** a segment contains an element type Core has no specific handling for
- **THEN** Core MUST pass it to the platform as a structured element
- **AND** Core MUST NOT replace it with literal text

#### Scenario: Model omits raw around markup-like text
- **WHEN** assistant output contains `List<String> generic` outside a `<raw>` region
- **THEN** Core MUST deliver the parsed result as-is
- **AND** Core MUST NOT attempt to reconstruct the original literal text

## REMOVED Requirements

### Requirement: Control Element Escaping
**Reason**: `h.parse()` natively converts `&lt;sep/&gt;` and `&lt;inner_thought&gt;`
into literal text nodes, so a host-owned unescape stage is redundant. Verbatim
literal text is now expressed through `<raw>`.
**Migration**: Remove `unescapeControlText`. Literal control text is produced by
`h.parse()` for entity forms and by `<raw>` for authored verbatim content.

### Requirement: Protection Zones
**Reason**: Protection zones inferred literal-text intent from fenced code, inline
code, and URLs. The host cannot determine whether `<` was markup or text, so the
heuristic is unbounded and never complete. `<raw>` moves the decision to the model,
which knows.
**Migration**: Delete `findProtectedRanges`, `isProtected`, and `PROTECTED_LITERAL`.
Instruct the model to wrap literal text in `<raw>`. When it does not, the parsed
result is delivered as-is; Core adds no recovery or warning.

### Requirement: Guardrails And Safe Degradation
**Reason**: The maximum-segment guardrail truncated replies and reported the
truncation through a `degraded` value no production code reads, making the
truncation silent. `ReplyPlan.degraded` and its three values are asserted only in
tests. Parse-failure fallback to a single sanitized message is replaced by literal
recovery, which preserves segmentation instead of discarding it.
**Migration**: Delete the `ReplyPlan` type, the `degraded` field, `maxSegments`,
the `reply.segmentation` configuration section, and the degradation branches.
`parseReply` returns ordered element segments. Unrecognized elements are delivered
as structured elements without recovery or warning. Bounding of total channel
occupancy is owned by pacing's total-delay ceiling.
