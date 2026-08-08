# memos-cloud-memory Specification

## Purpose

Define the MemOS Cloud long-term memory plugin for yesimbot, including plugin
registration, minimal LLM-visible memory tools, runtime-filled MemOS fields,
group-chat-friendly identity, prompt policy, diagnostics, and verification.
## Requirements
### Requirement: MemOS Cloud Plugin Registration
The MemOS client plugin MUST register exactly one AgentPlugin object through `ctx.yesimbot.agent.use(plugin)`, and the Agent-visible memory tool set MUST be limited to `search_message` and `add_message` in the first version.

#### Scenario: Plugin exposes minimal tools
- **WHEN** the MemOS client plugin starts
- **THEN** it MUST register an AgentPlugin object through `ctx.yesimbot.agent.use`
- **AND** the AgentPlugin MUST expose `search_message` and `add_message`
- **AND** it MUST NOT expose `get_memory`, `delete_memory`, `add_feedback`, `get_status`, or knowledge-base tools by default

#### Scenario: Plugin disposal unregisters object
- **WHEN** the MemOS client plugin stops
- **THEN** it MUST call the disposer returned by `agent.use`
- **AND** future channel runtimes MUST NOT receive the disposed MemOS AgentPlugin

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
- **AND** it MUST include configured search options such as `relativity`, `memory_limit_number`, `include_preference`, and `preference_limit_number` when configured
- **AND** it MUST NOT pass the current runtime `conversation_id` by default

#### Scenario: Search output is model-safe

- **WHEN** MemOS Cloud returns memories
- **THEN** `search_message` MUST return a normalized result containing memory content and optional relevance/confidence metadata
- **AND** it MUST NOT return API keys, auth headers, or raw transport internals

#### Scenario: Search failure is fail-open

- **WHEN** MemOS Cloud search fails due to network, non-2xx response, invalid response shape, timeout, auth, or rate limit
- **THEN** `search_message` MUST return an empty memory list with a structured sanitized error
- **AND** it MUST NOT throw solely because search failed

### Requirement: Import-Aware Search Filtering

The MemOS client plugin MUST support runtime-owned search filters that improve retrieval isolation without exposing filter controls to the LLM.

#### Scenario: Search input remains narrow

- **WHEN** the LLM calls `search_message`
- **THEN** the tool input schema MUST continue to expose only `query`
- **AND** it MUST NOT expose `filter`, `tags`, `conversation_id`, `agent_id`, raw source ids, or MemOS credentials

#### Scenario: Runtime applies context filter

- **WHEN** `search_message` executes in a group or private channel
- **THEN** the plugin MUST derive search scope from runtime identity and configuration
- **AND** it MUST be able to apply a MemOS `filter` for fields such as `agent_id`, `scene`, `memory_scope`, tags, or import source where configured
- **AND** the filter MUST be constructed by code, not by model-provided arguments

### Requirement: Safe Rich Search Results

The MemOS client plugin MUST return enough safe search metadata for the model to judge relevance and source context.

#### Scenario: Normalize fact memory metadata

- **WHEN** MemOS Cloud returns fact memories
- **THEN** `search_message` MUST be able to include safe fields such as memory id, memory key, memory value, conversation id, tags, confidence, relativity, and source type
- **AND** it MUST NOT include API keys, auth headers, raw unapproved source references, or transport internals

#### Scenario: Normalize preference metadata

- **WHEN** MemOS Cloud returns preference memories
- **THEN** `search_message` MUST preserve preference content and safe source context where available
- **AND** it MUST distinguish preferences from fact memories in the tool output

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

### Requirement: Standalone Historical Import Writes

Historical QQ import writes MUST be available through the package-local TypeScript script file, not through an Agent-visible runtime tool.

#### Scenario: Historical add message request

- **WHEN** the standalone import script performs a live import
- **THEN** code MUST call MemOS `POST /add/message` with historical `messages`, per-message `chat_time`, `user_id`, `conversation_id`, optional `agent_id`, tags, info, source, and async mode
- **AND** this operation MUST NOT be exposed as a default Agent-visible tool

#### Scenario: Runtime/import separation

- **WHEN** `plugins/memos-client` runtime tools are loaded
- **THEN** they MUST NOT expose bulk QQ import, review, approval, commit, or validation commands to the Agent

### Requirement: Shared MemOS Identity Semantics

Runtime tools and historical imports MUST use one deterministic MemOS identity standard so imported memories remain searchable from the matching live chat subject, while channel metadata MUST use the Core `channelIdentity` protocol.

#### Scenario: Subject user id

- **WHEN** runtime tools or import code derive `user_id`
- **THEN** they MUST treat `user_id` as the chat subject id
- **AND** they MUST derive it from `platform`, `channel_type`, and subject raw id
- **AND** they MUST NOT include bot `selfId` in `user_id`
- **AND** the id MUST be short enough for MemOS Cloud user id limits

#### Scenario: Bot agent id

- **WHEN** runtime tools or import code derive `agent_id`
- **THEN** they MUST derive it from `platform` and bot `selfId`
- **AND** they MAY use strict `agent_id` filters only when bot-level isolation is required

#### Scenario: Context conversation id

- **WHEN** runtime tools write a memory
- **THEN** `conversation_id` MUST identify the current runtime turn context
- **WHEN** historical import writes a memory chunk
- **THEN** `conversation_id` MUST identify that import chunk context
- **AND** `conversation_id` MUST NOT be used as the stable chat subject id

#### Scenario: Search across subject contexts

- **WHEN** `search_message` executes in a live chat
- **THEN** it MUST search with the chat subject `user_id`
- **AND** it MUST NOT pass the current runtime `conversation_id` by default
- **AND** it MAY apply code-owned filters for safe fields such as scene, memory scope, tags, import source, or agent id

#### Scenario: Core identity boundary

- **WHEN** MemOS identities are derived
- **THEN** MemOS-specific ids MUST be generated by `plugins/memos-client` shared identity code
- **AND** Core `channelIdentity` MUST NOT replace MemOS `user_id`, `conversation_id`, `agent_id`, author hash, or message hash

#### Scenario: Channel metadata uses Core identity

- **WHEN** the plugin sends MemOS `info` metadata for a channel
- **THEN** `channel_hash` MUST equal `YesImBotService.channelIdentity(scope)`
- **AND** the plugin MUST NOT serialize or hash Channel coordinates itself

#### Scenario: Shared channel assignee reload

- **WHEN** Koishi changes a shared Channel's assignee, an operator reloads that channel, and a later admitted event creates a runtime for the current assignee
- **THEN** memos-client MUST continue emitting the same `channel_hash`
- **AND** it MUST derive `agent_id` from the current bot `selfId`
#### Scenario: Identity uses stable hash versioning

- **WHEN** the plugin derives MemOS-owned identity fields
- **THEN** it MUST use stable versioned hash inputs
- **AND** it MUST use stable cryptographic hash representations rather than random ids

#### Scenario: Raw identity metadata is omitted by default

- **WHEN** the plugin sends MemOS `info` metadata
- **THEN** it MUST use hashed or canonical Key source metadata by default
- **AND** it MUST NOT send raw platform author, channel, self, or message ids unless explicitly configured

### Requirement: Default Runtime Memory Isolation

MemOS runtime tools MUST isolate memories by trusted runtime-derived scope by default. Automatic scope MUST use a channel subject for shared channels and a direct-user subject for direct channels, while preserving the existing MemOS-owned identity derivation.

#### Scenario: Shared channel uses automatic memory scope
- **WHEN** `memoryScope` uses its automatic default and a memory tool runs in a shared channel
- **THEN** the plugin MUST derive a channel-scoped subject identity
- **AND** another shared channel MUST NOT retrieve those memories solely because it uses the same active persona

#### Scenario: Direct channel uses automatic memory scope
- **WHEN** `memoryScope` uses its automatic default and a memory tool runs in a direct channel
- **THEN** the plugin MUST derive a direct-user subject identity
- **AND** shared-channel searches MUST NOT retrieve that private memory by default

### Requirement: Supported Memory Operation Disclosure

The first MemOS Cloud integration MUST describe only `search_message` and `add_message` as available memory operations. Its prompt MUST NOT claim persistent correction, deletion, inspection, versioning, or rollback capabilities that the plugin does not expose.

#### Scenario: User asks MemOS plugin to delete memory
- **WHEN** the active MemOS tool set contains no delete operation
- **THEN** the subject MUST not claim that it deleted or can delete the memory
- **AND** it MAY explain that the current memory plugin does not provide that operation

### Requirement: Model-Bounded Memory Scope

The MemOS Agent plugin MUST NOT expose a tool whose model-provided arguments select a raw platform channel, user, or wider memory scope. The first implementation MUST remove `debug_search_channel_memory` and its `enableDebugTools` configuration.

#### Scenario: Model inspects the MemOS tool registry
- **WHEN** the MemOS Agent plugin initializes
- **THEN** the visible tool registry MUST contain scoped `search_message` and `add_message`
- **AND** it MUST NOT contain a cross-channel debug search tool

### Requirement: Explicit MemOS Tool Outcomes

MemOS tools MUST return discriminated outcomes that distinguish completed search, persisted writes, accepted asynchronous work, and failures.

#### Scenario: Synchronous memory write completes
- **WHEN** `add_message` completes with asynchronous mode disabled
- **THEN** it MUST return `outcome: "persisted"`

#### Scenario: Asynchronous memory write is accepted
- **WHEN** `add_message` is accepted with asynchronous mode enabled
- **THEN** it MUST return `outcome: "accepted"`
- **AND** the subject MUST NOT claim that the memory is searchable

#### Scenario: Memory write fails
- **WHEN** `add_message` catches a sanitized backend failure
- **THEN** it MUST return `outcome: "failed"` with the error

#### Scenario: Memory search completes or fails
- **WHEN** `search_message` completes successfully
- **THEN** it MUST return `outcome: "completed"` with its memories
- **AND** a sanitized backend failure MUST return `outcome: "failed"` with an empty memory list and the error

### Requirement: Memory Prompt Policy

The MemOS client Agent plugin MUST provide the approved cache-stable long-term memory policy from `design.md` during Agent plugin initialization. The runtime MUST reuse identical policy content for the ChannelRuntime cache lifecycle. The policy MUST describe relevant search, selective autonomous writes, supported-operation limits, scoped-memory trust, explicit `persisted`/`accepted`/`failed` write outcomes, and terminal completion.

#### Scenario: Prompt instructs search-before-answer

- **WHEN** the MemOS Agent plugin initializes
- **THEN** the prompt MUST instruct the model to call `search_message` before answering user questions when relevant long-term memory may help
- **AND** it MUST instruct the model to use only memories that are relevant, same-subject, and not contradicted by current input

#### Scenario: Same-context imported memory use

- **WHEN** the plugin initializes its stable policy
- **THEN** it MUST instruct the model to use imported historical memories only when they are relevant, same-context, same-subject, and not contradicted by the current message
- **AND** it MUST instruct the model not to generalize one group member's statement into a global user fact

#### Scenario: Sensitive or uncertain memory

- **WHEN** retrieved memory appears sensitive, uncertain, stale, or about another person
- **THEN** the prompt MUST instruct the model to avoid relying on it unless the current context clearly makes it appropriate

#### Scenario: Prompt instructs selective write-after-answer

- **WHEN** the MemOS Agent plugin extends the system prompt
- **THEN** the policy MUST permit `add_message` without a separate permission request for new stable facts, durable preferences, project background, or long-term useful group information
- **AND** it MUST prohibit writes for transient requests, duplicates, secrets, credentials, payment data, unnecessary sensitive personal data, or short-lived emotions

#### Scenario: Prompt instructs terminal completion

- **WHEN** the plugin initializes its stable policy
- **THEN** the prompt MUST instruct the model to call `finalize_response({})` after required memory tools so the runtime does not continue generating

#### Scenario: Prompt describes operation limits

- **WHEN** the plugin initializes its stable policy
- **THEN** the policy MUST describe search and add behavior without implying unsupported correction or deletion

#### Scenario: Later model call uses memory policy
- **WHEN** a later model call runs in the same ChannelRuntime cache lifecycle
- **THEN** the runtime MUST reuse the frozen MemOS policy
- **AND** the plugin MUST NOT regenerate a different pre-history memory policy for that call

#### Scenario: Dynamic search result reaches the model
- **WHEN** `search_message` returns a different result in a later turn
- **THEN** that result MUST enter context as an append-only tool result
- **AND** it MUST NOT replace a memory system block before historical messages

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
