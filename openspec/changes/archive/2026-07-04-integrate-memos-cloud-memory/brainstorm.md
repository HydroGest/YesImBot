<!--
Raw capture of superpowers:brainstorming output.

This file captures the brainstorming skill output as raw notes and does not
force a strict structure. The skill output is usually a decision-log shape
(background -> decision chain Q1-Qn -> design trade-offs), but it may vary with
the conversation.

design.md extracts from this file and reorganizes the content into a structured
design document.

Do not copy this file verbatim into design.md. design.md is an independently
reorganized artifact; the two files complement each other without duplicating
content.
-->

# Brainstorm: MemOS Cloud Long-Term Memory

## Background

The goal is to integrate MemOS Cloud into yesimbot as a Koishi plugin, using the
existing `plugins/memos-client` scaffold and the current `@yesimbot/agent-runtime`
plugin system. The integration should provide practical long-term memory for an
Athena-style group chat agent, not just raw API wrappers.

The starting point is intentionally incomplete:

- `plugins/memos-client/src/index.ts` registers a prompt extension but exposes no tools.
- `plugins/memos-client/src/tools/core/add-message.ts` sketches `add_message` but is not implemented.
- `search-message.ts`, `get-memory.ts`, and other files are empty.
- `plugins/memos-client/package.json` and `plugins/sticker/package.json` currently have swapped package names.

Relevant runtime facts:

- Core creates one Agent runtime per `platform:selfId:channelId`.
- Koishi sessions become `athena.platform.message` custom messages containing source, author, message id, content, and timestamp.
- External Koishi plugins register per-channel Agent plugins through `ctx.yesimbot.registerAgentPlugin(factory)`.
- Agent tools receive runtime context (`runtime.id`, `storage`, `state`, `turnId`, etc.) but not the current Koishi `Session`.
- `extractAssistantTexts()` already extracts text from assistant content arrays, so an assistant step can contain both user-visible text and tool calls.
- AI SDK supports `stopWhen: hasToolCall(toolName)`, so a terminal tool can stop a multi-step tool loop cleanly without throwing.

## MemOS Cloud Constraints

The integration should use MemOS Cloud HTTP APIs in Node/TypeScript:

- Base URL: `https://memos.memtensor.cn/api/openmem/v1`, configurable.
- Auth: `Authorization: Token <apiKey>`.
- Core endpoints:
  - `POST /search/memory`
  - `POST /add/message`
- API keys must stay in server-side Koishi plugin config.
- Search and write failures should be diagnosable but should not fail the user-facing reply.
- `user_id` must be stable and short; MemOS limits user id length.
- Async write is acceptable for realtime chat; newly written memories may not be immediately searchable.

No `MEMOS_API_KEY` is currently present in the local environment, so live Cloud verification is deferred until implementation verification.

## Decision Chain

### Q1: What is the minimal LLM-visible tool set?

Three options were considered:

- A: `search_message` + `add_message`.
- B: `search_message` + `add_message` + `finalize_response`.
- C: Add management tools such as `get_memory`, `delete_memory`, `add_feedback`, `get_status`, and knowledge-base tools.

Chosen: **B**.

Rationale:

- `search_message` is required for search-before-answer.
- `add_message` is required for selective long-term write.
- `finalize_response` is required to let the model output final text, call memory-write tools, and then stop without another generation step.
- Management and knowledge-base tools are useful later, but they widen the first implementation and create privacy or safety risks in group chat.

### Q2: Where should `finalize_response` live?

Chosen: **`finalize_response` is an agent-runtime built-in terminal capability, enabled through Agent initialization config.**

yesimbot core should enable it by default. It is not a MemOS-specific tool; it is a generic loop-control tool.

The tool:

- Has empty input.
- Returns `{ finalized: true }`.
- Does not carry final text.
- Does not throw or abort.
- Stops the loop via `stopWhen: hasToolCall("finalize_response")`.

### Q3: How narrow should `add_message` input be?

Chosen: **`add_message` exposes only `{ content: string }` to the LLM.**

The application/runtime wraps that content into MemOS `messages`, e.g. as a single user-role message. This intentionally treats the tool as "write a refined long-term memory candidate", not as "send arbitrary chat transcripts to MemOS".

Reasons:

- Keeps the LLM parameter surface minimal.
- Avoids exposing `user_id`, `conversation_id`, `agent_id`, timestamps, auth, base URL, tags, filters, or metadata.
- Avoids asking the model to construct message roles or arrays.
- Reduces memory pollution from transient group chat content.

Known trade-off:

- It uses less of MemOS's full conversation-extraction ability than sending complete user/assistant turns.
- This is acceptable for v1 because the model is asked to write only already-filtered long-term facts/preferences.
- Future internal post-turn ingestion could write full message arrays without exposing that complexity to the LLM.

### Q4: How should group-chat identity map to MemOS `user_id`?

Initial idea: use `message.author.id`.

Rejected for group chat:

- Athena mainly runs in groups and acts like a groupmate.
- Group memory should preserve shared context, project background, and group-specific preferences.
- Per-author memory by default would fragment the group memory and risk poor recall.

Chosen:

- Group chats default to channel-scoped memory.
- Private chats default to author-scoped memory.
- Generated MemOS user ids use short hashes rather than raw platform ids.

Default shape:

```text
group:
  memos_user_id = yb_ch_<hash(v1|channel|platform|selfId|channelId)>

private:
  memos_user_id = yb_u_<hash(v1|user|platform|authorId)>
```

`hash` should be SHA-256 encoded as base64url and truncated to a stable short value, such as 22 characters.

Raw platform ids should not be sent to MemOS by default. Metadata should use hashed source fields such as `channel_hash`, `author_hash`, and `message_hash`.

### Q5: Should raw source ids appear in MemOS `info`?

Chosen: **No, not by default.**

The original reason for short `user_id` also applies to metadata. Default `info` should include enough hashed source metadata for diagnosis and grouping, without sending raw platform ids:

```ts
info: {
  scene: "group_chat" | "private_chat",
  platform,
  channel_type,
  channel_hash,
  author_hash,
  message_hash,
  turn_id,
  memory_scope: "channel" | "user"
}
```

A later explicit opt-in config may include raw identity metadata for local/private deployments or dashboard debugging.

### Q6: Should `get_memory`, `delete_memory`, `add_feedback`, `get_status`, and knowledge tools be exposed in v1?

Chosen: **No.**

Reasons:

- `get_memory` can leak broad memory context into ordinary group replies.
- `delete_memory` needs confirmation and should be an admin workflow.
- `add_feedback` is a correction/operations loop and lacks a first-version trigger policy.
- `get_status` is mostly async-debugging support.
- Knowledge-base tools are a separate retrieval capability and should not be mixed into personal/group long-term memory v1.

The existing empty files can be removed or left unregistered, but the default Agent-visible surface should stay at the three-tool loop above.

## Proposed Runtime Flow

```text
Koishi message
  -> athena.platform.message
  -> Agent model input
  -> search_message({ query })
  -> assistant final text
  -> optional add_message({ content })
  -> finalize_response({})
  -> stop tool loop
  -> core renders assistant text to chat
```

`search_message` and `add_message` should fail open:

- Search failure returns empty memories plus a structured error.
- Write failure returns success false plus a structured error.
- Neither should leak API keys or raw sensitive payloads.

## Prompt Policy

The MemOS plugin should extend the system prompt with rules like:

1. Before answering, use `search_message` to retrieve long-term memory relevant to the current request.
2. Use only memories that are relevant, same-subject, and not contradicted by current input.
3. Do not mention memory retrieval internals unless the user explicitly asks.
4. Write the final user-visible reply as text first.
5. If the turn reveals new stable user/group facts, durable preferences, project background, or other long-term useful information, call `add_message({ content })`.
6. Do not write transient requests, one-off jokes, duplicated facts, secrets, credentials, payment data, sensitive personal data, or short-lived emotions.
7. End with `finalize_response({})` after necessary tools.

## Configuration Defaults

Likely first-version defaults:

- `baseUrl`: `https://memos.memtensor.cn/api/openmem/v1`
- `apiKey`: required Koishi config.
- `memoryScope`: `"auto"`:
  - group -> channel memory
  - private -> user memory
- `identityHashVersion`: `"v1"`
- `searchMemoryLimit`: `6`
- `searchPreferenceLimit`: `6`
- `searchRelativity`: `0.45`
- `includePreference`: `true`
- `asyncMode`: `true`
- `tags`: `["yesimbot"]` plus chat-scope tag.
- `includeRawIdentityInfo`: `false`

## Architecture Notes

The MemOS plugin can recover current turn source context by observing `athena.platform.message` conversion in a pre-runtime plugin or by reading recent current-turn messages from storage/tool context. The current AgentTool execution context does not directly expose the current custom platform message. That is workable, but it should be documented as a boundary gap.

Future core/runtime improvements could expose a cleaner current-turn input context to tools, but v1 should avoid changing the entire runtime API solely for MemOS.

## Risks

- Some models may not reliably emit text followed by tool calls in a single assistant step.
- If the model omits `finalize_response`, the loop may continue naturally; tests should cover terminal behavior.
- Async MemOS writes may not be visible in immediate subsequent searches.
- Group-level memory may store claims from a single speaker as group context if the prompt is too permissive.
- Sending even hashed metadata to a third-party service has privacy implications; keep raw ids out by default.
- Existing `plugins/memos-client` package metadata appears swapped with `plugins/sticker` and must be corrected during implementation.

## Acceptance Shape

The change is successful when:

- `plugins/memos-client` registers and starts as a yesimbot plugin.
- Agent-visible MemOS tools are exactly `search_message` and `add_message` from the plugin.
- `agent-runtime` provides `finalize_response` as a built-in terminal tool and yesimbot enables it by default.
- Runtime fills `user_id`, `conversation_id`, `agent_id`, timestamps, auth, base URL, tags, and metadata.
- LLM-visible inputs remain minimal: search query and memory content only.
- Cloud HTTP calls use the documented endpoints, headers, content type, and request bodies.
- Failures are structured and diagnosable without exposing API keys.
- Type checks and focused tests pass.
- Live add/search verification is documented and can run when `MEMOS_API_KEY` is available.
