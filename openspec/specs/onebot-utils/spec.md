# onebot-utils Specification

## Purpose

Define the optional OneBot utility plugin that exposes adapter-specific runtime tools through the core agent plugin factory system while keeping OneBot internals out of `agent-runtime`.

## Requirements
### Requirement: OneBot Utils Plugin Registration

The OneBot utils plugin MUST register optional OneBot-specific runtime tools through `ctx.yesimbot.registerAgentPlugin`.

#### Scenario: Plugin registers through core service

- **WHEN** the Koishi plugin starts
- **THEN** it MUST register exactly one agent plugin factory through `ctx.yesimbot.registerAgentPlugin`
- **AND** it MUST dispose the registered factory when the Koishi plugin stops

#### Scenario: Non-OneBot channel runtime

- **WHEN** core calls the plugin factory for a channel whose `context.channel.platform` is not `onebot`
- **THEN** the returned `AgentPlugin` MUST expose no OneBot tools

#### Scenario: OneBot channel runtime

- **WHEN** core calls the plugin factory for a channel whose `context.channel.platform` is `onebot`
- **THEN** the returned `AgentPlugin` MUST expose OneBot utility tools built from `context.platform.unsafeBot`
- **AND** those tools MUST access adapter internals through plugin-owned closures rather than `AgentToolExecuteContext`

### Requirement: OneBot Forward Message Tool

The OneBot utils plugin MUST provide `onebot_get_forward_message`. It MUST call `unsafeBot.internal.getForwardMsg(messageId)` and return a sanitized paginated text-only result rather than raw adapter data. Tool input MUST accept required `messageId`, optional non-negative `offset` defaulting to zero, and optional `limit` defaulting to ten and clamped to twenty. Tool output MUST contain `forwardId`, applied `offset`, consecutive normalized `messages`, and `hasMore`. Every message record MUST contain `sender`, optional formatted `time`, and sanitized literal `content`; it MUST NOT contain a child message ID, raw OneBot fields, external URL, media bytes, or asset ID. Record content MUST be capped at 1,000 characters and page content at 6,000 characters. Content sanitization MUST remain local to the OneBot utils plugin and MUST NOT depend on core's private element, storage, or preparation helpers.

#### Scenario: Fetch first forward page

- **WHEN** the model calls `onebot_get_forward_message` with only a `messageId`
- **THEN** the tool MUST call `unsafeBot.internal.getForwardMsg(messageId)`
- **AND** it MUST return the first consecutive page using offset zero and limit ten
- **AND** the result MUST contain `forwardId`, `offset`, normalized messages, and `hasMore`

#### Scenario: Fetch later forward page

- **WHEN** the model calls `onebot_get_forward_message` with `offset` and `limit`
- **THEN** the tool MUST clamp limit to twenty
- **AND** it MUST return records consecutive from the applied offset
- **AND** it MUST set `hasMore` when unreturned records remain

#### Scenario: Content reaches a bound

- **WHEN** a forward record exceeds 1,000 characters or a page reaches 6,000 characters
- **THEN** the tool MUST truncate content without exposing raw data
- **AND** it MUST retain a consecutive next-page offset based on returned records

#### Scenario: Missing OneBot internal for forward message

- **WHEN** the model calls `onebot_get_forward_message` but `context.platform.unsafeBot.internal` is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the channel adapter does not support OneBot protocol internals

### Requirement: Structured OneBot Forward Content Normalization

Forward content normalization MUST treat adapter payloads as `unknown` and accept both raw text/CQ strings and structured OneBot segment arrays. Text segments MUST contribute text. Image, record, video, and file segments MUST become fixed text placeholders. Unknown segments MUST be dropped. Implementations MUST NOT implicitly stringify objects. The final text path MUST remove external URLs and unsupported CQ syntax before applying record and page limits.

#### Scenario: Forward record contains structured segments

- **WHEN** a forward record contains a structured OneBot segment array
- **THEN** text segments MUST contribute their text in source order
- **AND** image, record, video, and file segments MUST contribute only fixed text placeholders
- **AND** unknown segments MUST be omitted

#### Scenario: Forward record contains raw text or CQ content

- **WHEN** a forward record contains a raw text or CQ string
- **THEN** normalization MUST retain safe text while removing URLs and unsupported CQ syntax

#### Scenario: Forward record contains unsupported objects

- **WHEN** forward content has an unsupported object shape
- **THEN** normalization MUST omit that content rather than call implicit object stringification

#### Scenario: Forward record contains media

- **WHEN** a normalized forward record contains media
- **THEN** the tool MUST remove external media URLs
- **AND** it MUST represent supported media segments only with fixed text placeholders
- **AND** it MUST NOT download media or write private channel assets

### Requirement: OneBot Reaction Tool

The OneBot utils plugin MUST provide a `onebot_create_reaction` tool that creates a reaction on a OneBot message.

#### Scenario: Create message reaction

- **WHEN** the model calls `onebot_create_reaction` with `messageId` and `emojiId`
- **THEN** the tool MUST call `unsafeBot.internal._request("set_msg_emoji_like", { message_id, emoji_id })`
- **AND** `message_id` MUST equal the provided `messageId`
- **AND** `emoji_id` MUST equal the provided `emojiId`
- **AND** the tool MUST return the adapter request result

#### Scenario: Missing OneBot request capability

- **WHEN** the model calls `onebot_create_reaction` but `_request` is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the current channel adapter does not support OneBot requests

### Requirement: OneBot Essence Tool

The OneBot utils plugin MUST provide a `onebot_set_essence` tool that marks a OneBot message as essence.

#### Scenario: Set essence message

- **WHEN** the model calls `onebot_set_essence` with a `messageId`
- **THEN** the tool MUST call `unsafeBot.internal.setEssenceMsg(messageId)`
- **AND** the tool MUST return `{ "success": true }` when the adapter call completes

#### Scenario: Missing OneBot internal for essence message

- **WHEN** the model calls `onebot_set_essence` but `context.platform.unsafeBot.internal` is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the current channel adapter does not support OneBot protocol internals

### Requirement: Incomplete Legacy Tool Exclusion

The OneBot utils plugin MUST NOT expose the incomplete legacy `onebot_get_message_id` tool in the first migration.

#### Scenario: Resolve migrated tool names

- **WHEN** the OneBot utils agent plugin tools are resolved for a OneBot channel
- **THEN** the visible tool names MUST include `onebot_get_forward_message`, `onebot_create_reaction`, and `onebot_set_essence`
- **AND** the visible tool names MUST NOT include `onebot_get_message_id`
