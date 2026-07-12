## ADDED Requirements

### Requirement: MemOS Cloud Plugin Registration
The MemOS client plugin MUST register exactly one Agent plugin factory through `ctx.yesimbot.registerAgentPlugin`, and the Agent-visible memory tool set MUST be limited to `search_message` and `add_message` in the first version.

#### Scenario: Plugin exposes minimal tools
- **WHEN** the MemOS client plugin starts
- **THEN** it MUST register an Agent plugin factory through `ctx.yesimbot.registerAgentPlugin`
- **AND** the Agent plugin MUST expose `search_message` and `add_message`
- **AND** it MUST NOT expose `get_memory`, `delete_memory`, `add_feedback`, `get_status`, or knowledge-base tools by default

#### Scenario: Plugin disposal unregisters factory
- **WHEN** the MemOS client plugin stops
- **THEN** it MUST call the dispose function returned by `registerAgentPlugin`
- **AND** future channel runtimes MUST NOT receive the disposed MemOS Agent plugin

### Requirement: Minimal Search Tool Input
The `search_message` tool MUST expose only a search query to the LLM and MUST fill all reliable runtime fields from plugin configuration or Agent/platform context.

#### Scenario: LLM supplies only query
- **WHEN** the LLM calls `search_message`
- **THEN** the tool input schema MUST require `query`
- **AND** the schema MUST NOT expose `user_id`, `conversation_id`, `agent_id`, `baseUrl`, `apiKey`, auth headers, timestamps, filters, relevance thresholds, or result limits

#### Scenario: Search request uses runtime fields
- **WHEN** `search_message` executes
- **THEN** it MUST call `POST <baseUrl>/search/memory`
- **AND** it MUST set `Authorization: Token <apiKey>`
- **AND** it MUST set `Content-Type: application/json`
- **AND** it MUST include a runtime-derived `user_id`
- **AND** it MUST include the LLM-provided `query`
- **AND** it MUST include configured search options such as `conversation_id`, `relativity`, `memory_limit_number`, `include_preference`, and `preference_limit_number` when configured

#### Scenario: Search output is model-safe
- **WHEN** MemOS Cloud returns memories
- **THEN** `search_message` MUST return a normalized result containing memory content and optional relevance/confidence metadata
- **AND** it MUST NOT return API keys, auth headers, or raw transport internals

#### Scenario: Search failure is fail-open
- **WHEN** MemOS Cloud search fails due to network, non-2xx response, invalid response shape, timeout, auth, or rate limit
- **THEN** `search_message` MUST return an empty memory list with a structured sanitized error
- **AND** it MUST NOT throw solely because search failed

### Requirement: Minimal Add Message Tool Input
The `add_message` tool MUST expose only one `content` string to the LLM and MUST package that string into a MemOS `addMessage` request using runtime-filled identity, timing, and metadata.

#### Scenario: LLM supplies only content
- **WHEN** the LLM calls `add_message`
- **THEN** the tool input schema MUST require `content`
- **AND** the schema MUST NOT expose `messages`, `role`, `user_id`, `conversation_id`, `agent_id`, `chat_time`, `tags`, `info`, `baseUrl`, `apiKey`, or `async_mode`

#### Scenario: Add request wraps content as memory candidate
- **WHEN** `add_message` executes
- **THEN** it MUST call `POST <baseUrl>/add/message`
- **AND** it MUST set `Authorization: Token <apiKey>`
- **AND** it MUST set `Content-Type: application/json`
- **AND** it MUST include runtime-derived `user_id`, `conversation_id`, and `agent_id`
- **AND** it MUST include a `messages` array containing the LLM-provided content as a runtime-wrapped memory candidate
- **AND** it MUST include runtime-derived `chat_time` where available

#### Scenario: Add request includes safe metadata
- **WHEN** `add_message` builds the MemOS request body
- **THEN** it MUST include configured tags and safe `info` metadata such as scene, platform, channel type, hashed source ids, turn id, and memory scope
- **AND** it MUST NOT include raw platform `channelId`, `userId`, `selfId`, or message id by default

#### Scenario: Add failure is fail-open
- **WHEN** MemOS Cloud add message fails due to network, non-2xx response, invalid response shape, timeout, auth, or rate limit
- **THEN** `add_message` MUST return a structured sanitized failure result
- **AND** it MUST NOT throw solely because write failed

### Requirement: Group-Chat-Friendly Memory Identity
The MemOS client plugin MUST derive stable short MemOS identities that match yesimbot's group-chat use case while avoiding raw platform id exposure by default.

#### Scenario: Group channels use channel-scoped memory
- **WHEN** the current channel type is `group`
- **THEN** the plugin MUST derive MemOS `user_id` from platform, bot self id, and channel id
- **AND** the resulting id MUST use the `yb_ch_` prefix
- **AND** the id MUST be short enough for MemOS Cloud user id limits

#### Scenario: Private channels use author-scoped memory
- **WHEN** the current channel type is `private`
- **THEN** the plugin MUST derive MemOS `user_id` from platform and current author id
- **AND** the resulting id MUST use the `yb_u_` prefix
- **AND** the id MUST be short enough for MemOS Cloud user id limits

#### Scenario: Identity uses stable hash versioning
- **WHEN** the plugin derives a MemOS `user_id`
- **THEN** it MUST include an identity hash version in the hash input
- **AND** it MUST use a stable cryptographic hash representation rather than random ids

#### Scenario: Raw identity metadata is omitted by default
- **WHEN** the plugin sends MemOS `info` metadata
- **THEN** it MUST use hashed source metadata by default
- **AND** it MUST NOT send raw platform author, channel, self, or message ids unless an explicit future opt-in exists

### Requirement: Memory Prompt Policy
The MemOS client Agent plugin MUST extend the system prompt with a long-term memory usage policy that instructs the model to search before answering, selectively write durable memory after final text, and terminate with the runtime terminal tool.

#### Scenario: Prompt instructs search-before-answer
- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to call `search_message` before answering user questions when relevant long-term memory may help
- **AND** it MUST instruct the model to use only memories that are relevant, same-subject, and not contradicted by current input

#### Scenario: Prompt instructs selective write-after-answer
- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to write user-visible final text before memory write tools
- **AND** it MUST instruct the model to call `add_message` only for new stable facts, durable preferences, project background, or long-term useful group information
- **AND** it MUST instruct the model not to write transient requests, duplicates, secrets, credentials, payment data, sensitive personal data, or short-lived emotions

#### Scenario: Prompt instructs terminal completion
- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the prompt MUST instruct the model to call `finalize_response({})` after required memory tools so the runtime does not continue generating

### Requirement: MemOS Configuration
The MemOS client plugin MUST expose Koishi configuration for MemOS Cloud connection, identity behavior, search tuning, write mode, and metadata defaults while keeping sensitive values out of LLM-visible inputs.

#### Scenario: Required API key
- **WHEN** the MemOS client plugin starts without an API key
- **THEN** startup MUST fail with a clear configuration error or the plugin MUST decline to register tools with a clear diagnostic
- **AND** the API key MUST NOT be embedded in prompts or tool schemas

#### Scenario: Default Cloud base URL
- **WHEN** no base URL override is configured
- **THEN** the plugin MUST use `https://memos.memtensor.cn/api/openmem/v1`

#### Scenario: Configurable search defaults
- **WHEN** search tuning config is omitted
- **THEN** the plugin MUST use conservative defaults for memory limit, preference limit, relevance threshold, and preference inclusion

#### Scenario: Async write default
- **WHEN** write mode config is omitted
- **THEN** the plugin MUST use MemOS async write mode by default

### Requirement: MemOS Diagnostics and Verification
The MemOS client integration MUST provide clear local verification and optional live verification paths without leaking secrets.

#### Scenario: No-key local verification
- **WHEN** tests run without `MEMOS_API_KEY`
- **THEN** they MUST be able to verify request construction, tool schemas, prompt extension, identity hashing, and error handling without calling MemOS Cloud

#### Scenario: Optional live verification
- **WHEN** `MEMOS_API_KEY` is present and starts with `mpg-`
- **THEN** the integration documentation or tests MUST provide an optional add/search smoke test path
- **AND** the verification MUST avoid printing the raw API key

#### Scenario: Sanitized logging
- **WHEN** MemOS HTTP calls fail
- **THEN** logs MUST include enough diagnostic context to identify endpoint and failure category
- **AND** logs MUST NOT include raw API keys, auth headers, or full sensitive memory payloads by default
