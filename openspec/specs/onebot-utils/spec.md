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

- **WHEN** core calls the plugin factory for a channel whose scope platform is not `onebot`
- **THEN** the returned `AgentPlugin` MUST expose no OneBot tools

#### Scenario: OneBot channel runtime
- **WHEN** core calls the plugin factory for a channel whose scope platform is `onebot`
- **THEN** the returned `AgentPlugin` MUST expose OneBot utility tools whose closures use that runtime's supplied current Bot
- **AND** those tools MUST access adapter internals through those closures rather than `AgentToolExecuteContext`

### Requirement: OneBot Utils Forward Configuration

The plugin MUST expose `parseImages`, defaulting to `false`, `attachImageSummary`, defaulting to `true`, and a positive `maxForwardPageChars`, defaulting to `6000`. It MUST NOT expose a forward expansion-depth, cache-capacity, or cache-expiration setting.

#### Scenario: Default forward configuration

- **WHEN** no forward-specific configuration is supplied
- **THEN** images MUST be represented by text placeholders
- **AND** a page MUST have a 6,000-character text budget

### Requirement: OneBot Forward Message Tool

The OneBot utils plugin MUST provide `onebot_get_forward_message`. Input MUST accept required `forwardId`, an optional non-negative integer `offset` defaulting to zero, and an optional integer `limit` defaulting to thirty and clamped to sixty. The tool MUST first use a Runtime-scoped cache for that ID; on a cache miss it MUST call the current Bot's OneBot `internal.getForwardMsg(forwardId)` once and read only its returned array-form `message` segments, never `raw_message` or CQ text.

The result MUST have this compact shape:

```ts
type ForwardPart =
  | string
  | { image: readonly [summary: string, file: string, size: string | null] }
  | { forward: string }

type ForwardMessage = readonly [
  sender: string,
  time: string | null,
  content: readonly ForwardPart[],
]

type ForwardPage = {
  messages: readonly ForwardMessage[]
  nextOffset?: number
  tips?: string
  overLimit?: true
}

type ForwardResult = ForwardPage | { error: string }
```

`nextOffset` 和 `tips` 仅在仍有未读取的顶层消息时出现。`tips` MUST 明确告知剩余消息数，并说明使用相同 `forwardId` 和 `nextOffset` 继续读取；`nextOffset` 是下一页的输入偏移。`overLimit` MUST be present only when one complete first record exceeds the configured text budget and is returned as its own page.

#### Scenario: Fetch first forward page

- **WHEN** the model calls `onebot_get_forward_message` with only a `forwardId`
- **THEN** the tool MUST call the current Bot's OneBot internal with that ID when the ID is not cached
- **AND** it MUST start at offset zero and use limit thirty
- **AND** it MUST return compact message tuples without echoing the input ID or offset

#### Scenario: Continue a forward page

- **WHEN** a page contains `nextOffset` and `tips`
- **THEN** the tool description and `tips` MUST direct the model to call the same `forwardId` with that offset
- **AND** the following page MUST continue at that top-level message index

#### Scenario: Content reaches a page bound

- **WHEN** adding the next complete top-level record would make the page's string parts exceed `maxForwardPageChars`
- **THEN** the tool MUST omit that record from the page
- **AND** it MUST expose that record's index as `nextOffset`

#### Scenario: First record exceeds a page bound

- **WHEN** the first record at an offset exceeds `maxForwardPageChars` by itself
- **THEN** the tool MUST return the complete record as the only page message
- **AND** it MUST set `overLimit` to `true`
- **AND** it MUST NOT truncate that record's text

#### Scenario: Missing OneBot internal for forward message

- **WHEN** the model calls `onebot_get_forward_message` but the current Bot's OneBot internal is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the current channel adapter does not support OneBot protocol internals

### Requirement: Structured OneBot Forward Content Normalization

Forward content normalization MUST retain `text` segment text exactly and preserve source order. It MUST represent `record`, `video`, and `file` segments with `[语音]`, `[视频]`, and `[文件]` text placeholders. It MUST represent an unknown or malformed segment with `[未知消息段]`. Adjacent text and placeholder strings MUST be merged.

With `parseImages: false`, an image segment MUST become `[图片]`, unless its subtype is one (`sub_type: 1` or `subType: 1`), in which case it MUST become `[动画表情]`, or `[动画表情: <summary>]` when `attachImageSummary` is enabled and the segment has a non-empty summary. With `parseImages: true`, it MUST become `{ image: [summary, file, size] }` without an image URL or subtype. `file_size` MUST become a decimal human-readable literal: bytes below 1,000 use integer `B`; larger values use `KB`, `MB`, or `GB` with one decimal place, an ASCII space before the unit, and a base of 1,000. An invalid source or one that is not a non-negative safe integer MUST produce `null` for `size`.

A nested `forward` segment MUST become `{ forward: id }`. The tool MUST NOT inline its nested content, but when that content is already included in the same forward response, it MUST normalize and cache the content by that nested `forwardId` for a later call to the same tool. Normal text URLs MUST remain intact. The tool MUST NOT download media, write channel assets, return media bytes, or stringify raw OneBot objects.

#### Scenario: Image parsing is disabled

- **WHEN** a forward contains an image and `parseImages` is false
- **THEN** the corresponding content part MUST be the string `[图片]`
- **AND** it MUST be the string `[动画表情]` when the image subtype is one
- **AND** it MUST be the string `[动画表情: <summary>]` when the image subtype is one and summary attachment is enabled

#### Scenario: Image parsing is enabled

- **WHEN** a forward contains an image and `parseImages` is true
- **THEN** the corresponding content part MUST contain only its summary, file, and formatted size
- **AND** it MUST NOT contain a URL or subtype

#### Scenario: Nested forward is encountered

- **WHEN** a forward contains a nested forward segment
- **THEN** the corresponding content part MUST be `{ forward: id }`
- **AND** it MUST NOT inline the nested forward's messages

#### Scenario: Expanded nested forward is read from cache

- **WHEN** a `forwardId` response includes a nested forward's expanded content
- **THEN** the tool MUST cache its normalized top-level messages under that nested `forwardId`
- **WHEN** the model later calls the tool with that `forwardId`
- **THEN** the tool MUST return the cached messages without calling `getForwardMsg`

#### Scenario: Unknown forward segment is encountered

- **WHEN** a forward contains a segment outside the supported shapes
- **THEN** the corresponding content part MUST be `[未知消息段]`

### Requirement: OneBot Utils Animated Image Projection

The plugin MUST project OneBot image elements whose subtype is one (`sub_type: 1` or `subType: 1`) or whose summary is a non-empty string as animated emoji before Core renders the main channel message for the model. Persisted images MUST become `[动画表情: asset://<id>]`, or `[动画表情: <summary> asset://<id>]` when `attachImageSummary` is enabled and the image has a non-empty summary. Unpersisted images MUST become `[动画表情]`, or `[动画表情: <summary>]` with summary attachment enabled. Images without subtype one and with an empty or missing summary MUST remain unchanged so Core can render its normal `[图片]` projection.

#### Scenario: Main message contains an animated image

- **WHEN** an OneBot message entry contains a persisted image element with subtype one or a non-empty summary
- **THEN** the plugin MUST replace that image element with the text element `[动画表情: asset://<id>]` before Core's model-input projection
- **AND** it MUST include the image summary when summary attachment is enabled

#### Scenario: Main message contains an ordinary image

- **WHEN** an OneBot message entry contains a persisted image element without subtype one and without a non-empty summary
- **THEN** the plugin MUST leave that image element unchanged

### Requirement: Runtime-Scoped Forward Cache

For each ChannelRuntime, the tool MUST cache every successfully normalized top-level result and every included expanded nested result by `forwardId` for that Runtime's lifetime. Later pages and repeated reads of a cached ID MUST use its cached result rather than call the OneBot API again. On an uncached ID, the tool MUST call the OneBot API once; if it returns no array-form forward message, the tool MUST return `{ error: "未找到合并转发消息: <forwardId>" }`. Failed reads and failed normalization MUST NOT be cached. The cache MUST have no capacity or time-expiration limit and MUST be released when its Runtime is released.

#### Scenario: Cached result is reused

- **WHEN** the model requests a later page for a previously successful `forwardId`
- **THEN** the tool MUST serve that page from the Runtime-scoped cached result
- **AND** it MUST NOT call `getForwardMsg` again

#### Scenario: Unavailable forward returns a tool result

- **WHEN** an uncached `forwardId` has no array-form result from the OneBot API
- **THEN** the tool MUST return `{ error: "未找到合并转发消息: <forwardId>" }`

### Requirement: OneBot Reaction Tool

The OneBot utils plugin MUST provide a `onebot_create_reaction` tool that creates a reaction on a OneBot message.

#### Scenario: Create message reaction

- **WHEN** the model calls `onebot_create_reaction` with `messageId` and `emojiId`
- **THEN** the tool MUST call the current Bot's OneBot internal `_request("set_msg_emoji_like", { message_id, emoji_id })`
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
- **THEN** the tool MUST call the current Bot's OneBot internal `setEssenceMsg(messageId)`
- **AND** the tool MUST return `{ "success": true }` when the adapter call completes

#### Scenario: Missing OneBot internal for essence message

- **WHEN** the model calls `onebot_set_essence` but the current Bot's OneBot internal is unavailable
- **THEN** the tool MUST fail with a clear error indicating that the current channel adapter does not support OneBot protocol internals

### Requirement: Incomplete Legacy Tool Exclusion

The OneBot utils plugin MUST NOT expose the incomplete legacy `onebot_get_message_id` tool in the first migration.

#### Scenario: Resolve migrated tool names

- **WHEN** the OneBot utils agent plugin tools are resolved for a OneBot channel
- **THEN** the visible tool names MUST include `onebot_get_forward_message`, `onebot_create_reaction`, and `onebot_set_essence`
- **AND** the visible tool names MUST NOT include `onebot_get_message_id`
