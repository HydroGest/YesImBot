## ADDED Requirements

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

The OneBot utils plugin MUST provide a `onebot_get_forward_message` tool that fetches the raw message list for a OneBot forward message id.

#### Scenario: Fetch forward message

- **WHEN** the model calls `onebot_get_forward_message` with a `messageId`
- **THEN** the tool MUST call `unsafeBot.internal.getForwardMsg(messageId)`
- **AND** the tool MUST return the forward message list returned by the adapter

#### Scenario: Missing OneBot internal for forward message

- **WHEN** the model calls `onebot_get_forward_message` but `context.platform.unsafeBot.internal` is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the current channel adapter does not support OneBot protocol internals

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
