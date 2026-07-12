## Why

Athena primarily runs in group chats, but yesimbot currently only has session
JSONL history. It does not have long-term memory that survives restarts, supports
semantic retrieval, or can be isolated by channel. The existing
`plugins/memos-client` package is only a scaffold and does not yet register
usable tools or complete MemOS Cloud API calls. This change integrates MemOS
Cloud as a maintainable plugin and adds runtime support for writing memory after
the final assistant text before stopping the tool loop.

## What Changes

**MemOS Cloud Memory Plugin**
- From: `plugins/memos-client` only has an incomplete `add_message` draft and
  prompt text, so the Agent has no usable memory tools.
- To: The plugin registers the two minimal LLM-visible tools,
  `search_message(query)` and `add_message(content)`, backed by MemOS Cloud
  `POST /search/memory` and `POST /add/message`.
- Reason: Provide a long-term memory loop with retrieval before answering and
  selective writes after answering.
- Impact: Adds plugin capability without breaking existing behavior, but live
  verification requires a valid MemOS API key.

**Minimal Runtime Field Exposure**
- From: The runtime-field ownership rule only exists partially in the current
  draft.
- To: `user_id`, `conversation_id`, `agent_id`, timestamps, auth, base URL, tags,
  info, search thresholds, and limits are filled by config or runtime context;
  the LLM only supplies the search query and memory content.
- Reason: Reduce tool misuse, avoid exposing sensitive fields, and keep group
  chat memory consistent.
- Impact: Tool schemas are narrower and calls are more stable.

**Terminal Tool Loop Control**
- From: `agent-runtime` relies on natural tool-loop completion and has no generic
  marker for "call tools after final text, then stop".
- To: `agent-runtime` provides a built-in `finalize_response({})` terminal tool;
  yesimbot enables it when creating Agents and stops later tool-loop steps with
  `hasToolCall("finalize_response")`.
- Reason: Let the model emit final text, call `add_message`, and explicitly
  finish in the same assistant step.
- Impact: Updates runtime configuration and core Agent initialization. The tool
  is enabled by default in core, but its semantics are empty and safe.

**Group-Chat-Friendly Identity**
- From: Mapping MemOS `user_id` directly from `message.author.id` fragments
  group memory into per-author memory.
- To: Group chats default to channel-scoped short-hash `user_id`; private chats
  use author-scoped short-hash `user_id`; raw platform IDs are not sent to MemOS
  request bodies by default.
- Reason: Athena is primarily a group-chat Agent, so it should prioritize group
  context while reducing raw identity exposure to the external service.
- Impact: Dashboard `user_id` values are not directly readable, but they are
  stable, short, and more private.

## Capabilities

### New Capabilities
- `memos-cloud-memory`: MemOS Cloud long-term memory plugin capability,
  including the minimal tool set, HTTP client, runtime identity filling, prompt
  policy, error handling, and verification path.

### Modified Capabilities
- `agent-runtime-core`: Add configurable built-in terminal tool support and
  define tool-loop stopping semantics.
- `core-runtime-integration`: Enable the terminal tool by default when yesimbot
  core creates Agents while preserving final assistant text rendering behavior.

## Impact

- Affected packages:
  - `plugins/memos-client`
  - `packages/agent-runtime`
  - `core`
- Affected APIs:
  - `AgentConfig` gains terminal tool configuration.
  - yesimbot core Agent initialization enables the runtime terminal tool.
  - `plugins/memos-client` Koishi config gains MemOS Cloud settings.
- External services:
  - MemOS Cloud HTTP API (`/search/memory`, `/add/message`).
- Verification:
  - Type checks and focused tests for `@yesimbot/agent-runtime`, `koishi-plugin-yesimbot`, and `koishi-plugin-yesimbot-memos-client`.
  - Optional live add/search check when `MEMOS_API_KEY` is configured.
