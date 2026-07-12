## Context

yesimbot is a Yarn 4 monorepo with a Koishi core plugin, an experimental
`@yesimbot/agent-runtime`, and optional Koishi plugins registered through
`ctx.yesimbot.registerAgentPlugin(factory)`. Core creates one Agent runtime per
`platform:selfId:channelId`, converts Koishi messages into
`athena.platform.message`, and renders assistant text through
`extractAssistantTexts()`.

`plugins/memos-client` exists but is currently only a scaffold. It has an
unfinished `add_message` draft, empty tool files, no working MemOS HTTP client,
and no registered Agent-visible tools. Its package metadata also appears swapped
with `plugins/sticker`, so package names must be corrected as part of making the
plugin buildable.

MemOS Cloud should be integrated as server-side HTTP calls from the Koishi
plugin. The API key must live in plugin config, not in LLM-visible tool inputs.
The first version should serve Athena's primary group-chat use case: remember
stable group facts, project context, durable preferences, and long-term useful
information without polluting memory with transient chat.

## Goals / Non-Goals

**Goals:**

- Provide a complete MemOS Cloud integration in `plugins/memos-client`.
- Expose only the minimal LLM-visible memory tools: `search_message(query)` and
  `add_message(content)`.
- Add a generic runtime terminal tool, `finalize_response({})`, so the model can
  output final text, optionally write memory, and then stop the tool loop.
- Fill MemOS runtime fields from config and current Agent/platform context:
  `user_id`, `conversation_id`, `agent_id`, timestamps, auth, base URL, tags,
  info, and search tuning.
- Default group chat memory to channel-scoped short hash identity; default
  private chat memory to author-scoped short hash identity.
- Keep raw platform ids out of MemOS request bodies by default.
- Fail open for search/write API failures while logging diagnostics without API
  key leakage.
- Add tests and focused verification commands.

**Non-Goals:**

- Do not use MemOS Chat API to generate replies.
- Do not expose `get_memory`, `delete_memory`, `add_feedback`, `get_status`, or
  knowledge-base tools as default Agent tools.
- Do not implement admin memory management workflows in this change.
- Do not introduce a broad new Agent runtime current-session API unless the
  existing plugin/hook context is insufficient.
- Do not send full raw group chat transcripts to MemOS through the LLM-visible
  `add_message` tool.

## Decisions

### D1: Use addMessage + searchMemory over Chat API

- **Choice**: Integrate MemOS Cloud through HTTP `POST /search/memory` and
  `POST /add/message`.
- **Reason**: yesimbot already owns model selection, prompt construction, tool
  execution, and reply rendering. MemOS should provide memory, not replace the
  LLM pipeline.
- **Considered alternative**: MemOS Chat API. Rejected because it would duplicate or
  bypass yesimbot's existing Agent loop and reduce control over model providers,
  tools, and group-chat behavior.

### D2: Keep LLM-visible MemOS tools minimal

- **Choice**: Register only `search_message(query)` and `add_message(content)` from
  the MemOS plugin.
- **Reason**: The model only needs to decide what to search for and what durable
  memory candidate to write. All reliable runtime fields are better filled by
  code.
- **Considered alternative**: Expose message arrays, tags, filters, ids, or admin
  tools. Rejected for v1 because it widens the attack/bug surface and risks
  memory pollution in group chat.

### D3: Add `finalize_response` as an agent-runtime built-in

- **Choice**: Add a configurable built-in terminal tool to `@yesimbot/agent-runtime`
  and enable it by default when yesimbot core creates Agents.
- **Reason**: The terminal tool is generic loop control, not MemOS-specific. It
  lets the model emit user-visible final text and then call tools such as
  `add_message` without triggering another generation step.
- **Considered alternative**: Implement a MemOS-specific terminal tool. Rejected
  because termination semantics belong to the runtime loop.
- **Considered alternative**: Throw or abort from a terminal tool. Rejected because
  that would mark the turn as failed or aborted rather than successfully
  finalized.

### D4: Stop with `hasToolCall("finalize_response")`

- **Choice**: Use AI SDK stop conditions to stop the multi-step loop when the
  terminal tool is called.
- **Reason**: The AI SDK already exposes `hasToolCall(toolName)`, and stop
  conditions preserve successful turn completion.
- **Considered alternative**: Detect terminal tool results in custom runtime state and
  manually interrupt. Rejected as more complex and less aligned with the SDK.

### D5: Default group chat to channel-scoped memory

- **Choice**: For group channels, derive MemOS `user_id` from channel identity, not
  from the current message author. For private chats, derive it from author
  identity.
- **Reason**: Athena mostly behaves as a groupmate. Group project context and shared
  norms should be recalled as group memory; per-author default memory would
  fragment recall.
- **Considered alternative**: Always author-scoped memory. Rejected for group chats.
- **Considered alternative**: Hybrid group + author memory in v1. Deferred because it
  raises retrieval merging, duplication, and privacy questions.

### D6: Use short hashed identity by default

- **Choice**: Derive short stable MemOS ids:

  ```text
  group:
    yb_ch_<base64url_sha256(v1|channel|platform|selfId|channelId)[0..22]>

  private:
    yb_u_<base64url_sha256(v1|user|platform|authorId)[0..22]>
  ```

- **Reason**: This keeps `user_id` short, stable, and less revealing.
- **Considered alternative**: Use readable raw ids. Rejected because platform ids can
  be long and leak more identity data into the external memory service.

### D7: Keep raw source ids out of MemOS `info` by default

- **Choice**: Send hashed source metadata such as `channel_hash`, `author_hash`,
  `message_hash`, `memory_scope`, and `turn_id`; do not send raw `channel_id` or
  `author_id` by default.
- **Reason**: If raw ids are hidden in `user_id` but exposed in `info`, the privacy
  benefit is lost.
- **Considered alternative**: Put raw ids in `info` for Dashboard readability.
  Deferred behind a possible explicit opt-in config.

### D8: Treat `add_message(content)` as refined memory candidate input

- **Choice**: Runtime wraps `content` as a MemOS message, rather than letting the
  LLM construct arbitrary MemOS message arrays.
- **Reason**: This keeps tool input narrow and asks the model to write only durable
  facts/preferences/project context that it has already filtered.
- **Considered alternative**: Expose `messages: [{ role, content }]`. Rejected for v1
  because it asks the model to manage roles and encourages dumping raw dialogue.

### D9: Fail open but diagnose clearly

- **Choice**: Memory search/write API failures return structured tool errors and log
  sanitized diagnostics. They do not fail the user-facing turn.
- **Reason**: Long-term memory improves quality but should not make chat replies
  brittle.
- **Considered alternative**: Throw on all MemOS failures. Rejected because outages,
  invalid keys, or rate limits would break normal chat.

## Risks / Trade-offs

[Risk] Some providers may not reliably emit assistant text and tool calls in the
same step. → Mitigation: Add runtime/core tests for mixed text + terminal tool
messages and document provider behavior as a live verification item.

[Risk] Async MemOS writes are not immediately searchable. → Mitigation: Default
to `async_mode: true` for chat responsiveness and document live verification
with wait/retry.

[Risk] Group-scoped memory can overgeneralize a single speaker's claim as group
context. → Mitigation: Prompt the model to write only stable group facts,
durable preferences, and project context; include hashed author metadata in
`info` for diagnosis.

[Risk] Tool failures could leak API keys or sensitive content in logs. →
Mitigation: Use sanitized errors, never log auth headers or raw API keys, and
avoid logging full memory payloads by default.

[Risk] The current tool execution context does not directly expose the current
platform message. → Mitigation: Capture current turn platform context through
existing message conversion/storage hooks where possible; document any remaining
gap and keep the first implementation local to the plugin/runtime boundary.

[Trade-off] `add_message(content)` does not use MemOS's full conversation-array
extraction path. → Accepted because first-version correctness is more about
avoiding memory pollution than maximizing extraction richness.

## Migration Plan

1. Correct `plugins/memos-client` package metadata so the workspace package name
   matches the directory and plugin.
2. Add terminal tool configuration and built-in tool support to
   `@yesimbot/agent-runtime`.
3. Enable the terminal tool by default in yesimbot core Agent creation.
4. Implement `plugins/memos-client` config, identity hashing, MemOS HTTP client,
   `search_message`, `add_message`, and prompt extension.
5. Add focused unit tests for runtime terminal behavior, core default enablement,
   MemOS request construction, failure handling, and prompt/tool registration.
6. Run scoped type checks/tests.
7. If `MEMOS_API_KEY` is available, run an optional live add/search smoke test.

Rollback strategy:

- Disable or remove the MemOS Koishi plugin to stop external memory calls.
- If terminal tool behavior causes provider issues, disable the runtime terminal
  tool config while leaving other Agent tools unchanged.
- No database migration is involved.

## Open Questions

- Whether to expose an explicit `includeRawIdentityInfo` config in v1 or defer it
  entirely. Default remains `false` either way.
- Whether future work should add an internal post-turn full-conversation
  ingestion path for MemOS, separate from the LLM-visible `add_message(content)`
  tool.
- Whether future work should support hybrid group + author memory retrieval.
