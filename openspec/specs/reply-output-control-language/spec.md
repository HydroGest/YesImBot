# reply-output-control-language Specification

## Purpose

Define how Core protects private thought and verbatim text while passing standard Koishi message elements to platform delivery.

## Requirements

### Requirement: Native Koishi Element Stream
Core MUST parse complete assistant output with `h.parse()` as a Koishi element stream. Core MUST preserve every resulting element, including `<message>` and elements whose type Core does not recognize. Core MUST NOT maintain an element allowlist, custom structured-output container, or custom segment control.

#### Scenario: Assistant outputs a standard message element
- **WHEN** assistant output contains `<message>second</message>` after `first`
- **THEN** Core MUST pass the `message` element and its children to the platform delivery call
- **AND** Core MUST NOT replace it with multiple Core-managed delivery calls

#### Scenario: Assistant outputs an unknown element
- **WHEN** assistant output contains an element type unknown to Core
- **THEN** Core MUST preserve the element and its attributes in the platform delivery fragment

### Requirement: Standard Message Boundaries
Assistant output MUST use the standard `<message>` element for an explicit message boundary. A `<message>` element MUST retain its standard Koishi semantics: previous content and the element body are separate platform messages, and nested message elements are handled by the platform encoder.

#### Scenario: Adjacent message boundary
- **WHEN** assistant output is `first<message/>second`
- **THEN** Core MUST pass both text nodes and the empty `message` element in one delivery fragment

#### Scenario: Nested message element
- **WHEN** a `message` element contains another `message` element
- **THEN** Core MUST preserve the nesting for the platform encoder

### Requirement: Verbatim Text Container
Core MUST extract every `<text>…</text>` region before parsing the surrounding element stream and restore its content as text nodes byte-for-byte. Core MUST NOT parse or unescape text-container content. An unterminated `<text>` region extends through the end of the assistant output.

#### Scenario: Text contains element-looking syntax
- **WHEN** assistant output contains `<text>List<String> generic</text>`
- **THEN** Core MUST deliver `List<String> generic` as text
- **AND** Core MUST NOT create a `String` element

#### Scenario: Text contains a message element
- **WHEN** a text container includes `<message>visible</message>`
- **THEN** Core MUST deliver the complete sequence as visible text
- **AND** it MUST NOT create a message boundary

### Requirement: Private Inner Thought Handling
Core MUST remove every `<inner_thought>` subtree from the delivered element stream and MUST NOT deliver its content to any reader. Core MUST retain the raw assistant output including inner-thought content in channel JSONL, and MUST replay it unchanged to the model as the model's own history.

#### Scenario: Inner thought is nested in a message element
- **WHEN** an assistant message contains `<message>visible<inner_thought>private</inner_thought></message>`
- **THEN** Core MUST preserve the `message` element
- **AND** its delivered children MUST contain `visible` but no inner-thought content

### Requirement: Optional Final Reply Wrapper

Core MAY expose a configuration that adds a final-reply wrapper protocol for
relay/proxy stations which merge untagged reasoning into message content. When
enabled, Core MUST instruct the model to place all user-visible output inside one
`<reply>…</reply>` element. If an assistant message contains a complete
`<reply>` wrapper, Core MUST deliver only the wrapper contents and MUST discard
text outside the wrapper; raw assistant output MUST remain unchanged in history.

#### Scenario: Untagged reasoning precedes a wrapped final reply
- **WHEN** Core enables final reply wrapping and an assistant message contains untagged reasoning followed by `<reply>visible</reply>`
- **THEN** Core MUST deliver only `visible`
- **AND** Core MUST retain the raw message including the untagged reasoning in channel history

### Requirement: Literal Element Syntax
Assistant output that intends to display `<` or `>` as text MUST encode them as `&lt;` or `&gt;`, or place the complete literal region in `<text>…</text>`. Core MUST pass unprotected element-looking syntax to the Koishi parser as structured message elements.

#### Scenario: Escaped message syntax
- **WHEN** assistant output contains `&lt;message&gt;example&lt;/message&gt;`
- **THEN** Core MUST deliver the sequence as text

#### Scenario: Text placeholder cannot be forged
- **WHEN** assistant output contains text resembling Core's internal text placeholder
- **THEN** Core MUST NOT substitute captured text at that position
- **AND** the text MUST be delivered as ordinary content
