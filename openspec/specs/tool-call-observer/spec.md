# tool-call-observer Specification

## Purpose

Define the optional YesImBot tool observer Koishi plugin for immediate chat-visible tool call notifications, bounded TOON previews, redaction, filtering, and opt-in model-visible TOON result compression.

## Requirements

### Requirement: Optional Tool Observer Plugin

YesImBot MUST provide an optional Koishi plugin capability that observes agent-runtime tool calls through the existing `ctx.yesimbot.registerAgentPlugin()` extension path.

#### Scenario: Plugin registers one agent plugin per channel runtime

- **WHEN** the Koishi tool observer plugin starts
- **THEN** it MUST register an agent plugin factory through `ctx.yesimbot.registerAgentPlugin()`
- **AND** each created channel runtime MUST receive one tool observer `AgentPlugin`

#### Scenario: Core runtime handles remain hidden

- **WHEN** the tool observer plugin registers its agent plugin factory
- **THEN** it MUST use only the public channel agent context and agent plugin hooks
- **AND** it MUST NOT require core to expose direct runtime handles, Koishi `Session`, or large internal tool event payloads

### Requirement: Immediate Tool Call Notification

The tool observer plugin MUST send one chat notification immediately after each non-ignored tool call completes or fails.

#### Scenario: Successful tool notification

- **WHEN** a non-ignored tool call completes successfully
- **THEN** the plugin MUST send a chat message before waiting for the whole turn to finish
- **AND** the message MUST include the tool name, success status, elapsed time, argument overview, and result overview

#### Scenario: Failed tool notification

- **WHEN** a non-ignored tool call fails and the runtime exposes the failure through `afterToolCall`
- **THEN** the plugin MUST send a chat message before waiting for the whole turn to finish
- **AND** the message MUST include the tool name, error status, elapsed time, argument overview, and error/result overview

#### Scenario: Notification send failure

- **WHEN** the plugin cannot send a tool notification to the chat channel
- **THEN** it MUST report or log the notification failure without failing the active agent turn

### Requirement: TOON Chat Preview Formatting

The tool observer plugin MUST render JSON-like argument and result previews in TOON format for chat notifications.

#### Scenario: JSON-like arguments are displayed as TOON

- **WHEN** a displayed tool argument value is JSON-like
- **THEN** the chat notification MUST render the argument overview in TOON format

#### Scenario: JSON-like results are displayed as TOON

- **WHEN** display of tool results is enabled and the displayed result value is JSON-like
- **THEN** the chat notification MUST render the result overview in TOON format

#### Scenario: Non-JSON-like values use safe previews

- **WHEN** a displayed argument or result value is not JSON-like
- **THEN** the chat notification MUST render a bounded safe textual preview instead of attempting unsafe serialization

### Requirement: Redaction And Preview Limits

The tool observer plugin MUST redact configured sensitive keys and bound preview size before sending tool details to chat.

#### Scenario: Sensitive key redaction

- **WHEN** a displayed argument or result contains an object key that matches configured redaction keys
- **THEN** the chat notification MUST replace that value with a redacted marker

#### Scenario: Preview length limit

- **WHEN** a formatted chat notification section exceeds the configured preview length limit
- **THEN** the plugin MUST truncate that section and indicate that truncation occurred

### Requirement: Tool Filtering

The tool observer plugin MUST support configured ignored tool names and MUST ignore the terminal tool by default.

#### Scenario: Ignored tool is not notified

- **WHEN** a tool call name is listed in `ignoredTools`
- **THEN** the plugin MUST NOT send a chat notification for that tool call

#### Scenario: Terminal tool ignored by default

- **WHEN** the runtime calls the default terminal tool `finalize_response`
- **THEN** the plugin MUST NOT send a chat notification unless configuration explicitly removes it from the ignored tool list

### Requirement: Optional TOON Tool Result Compression

The tool observer plugin MUST support opt-in replacement of JSON-like successful tool results with TOON strings for model-visible tool result compression.

#### Scenario: Compression disabled by default

- **WHEN** `compressJsonToolResults` is not enabled
- **THEN** the plugin MUST return no result replacement from `afterToolCall`
- **AND** the model-visible tool result MUST remain the original runtime value

#### Scenario: JSON-like successful result is compressed

- **WHEN** `compressJsonToolResults` is enabled
- **AND** a successful non-ignored tool call returns a JSON-like result
- **THEN** the plugin MUST return an `afterToolCall` patch that replaces the result with a TOON string

#### Scenario: Non-JSON-like result is not compressed

- **WHEN** `compressJsonToolResults` is enabled
- **AND** a successful tool call returns a non-JSON-like result
- **THEN** the plugin MUST leave the model-visible tool result unchanged

#### Scenario: Failed result is not compressed for the model

- **WHEN** `compressJsonToolResults` is enabled
- **AND** a tool call result context has `isError: true`
- **THEN** the plugin MUST leave the model-visible error result unchanged

### Requirement: Configuration Surface

The tool observer plugin MUST expose a focused configuration surface for notification content, filtering, redaction, and optional result compression.

#### Scenario: Default configuration is observational

- **WHEN** the plugin starts with default configuration
- **THEN** it MUST send immediate tool notifications
- **AND** it MUST NOT rewrite model-visible tool results

#### Scenario: Display sections are configurable

- **WHEN** `displayArgs` or `displayResult` is disabled
- **THEN** the plugin MUST omit the corresponding section from chat notifications

#### Scenario: Compression limit is enforced

- **WHEN** `compressJsonToolResults` is enabled and a TOON result exceeds the configured compressed result limit
- **THEN** the plugin MUST apply the configured limit or decline replacement rather than returning an unbounded model-visible result
