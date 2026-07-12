## 1. Workspace and Package Metadata

- [x] 1.1 Correct `plugins/memos-client/package.json` and `plugins/sticker/package.json` package names so each workspace name matches its directory.
- [x] 1.2 Confirm `plugins/memos-client` builds as its own Yarn workspace and uses existing monorepo scripts/patterns.

## 2. Agent Runtime Terminal Tool

- [x] 2.1 Add focused tests for an opt-in runtime terminal tool named `finalize_response`.
- [x] 2.2 Add `AgentConfig` terminal tool configuration with default disabled at the runtime package boundary.
- [x] 2.3 Implement the built-in terminal tool with empty input and `{ finalized: true }` output.
- [x] 2.4 Stop the tool loop when the configured terminal tool is called without throwing, aborting, or failing the turn.
- [x] 2.5 Verify terminal tool name conflicts use existing tool conflict behavior.

## 3. Core Runtime Integration

- [x] 3.1 Add tests showing yesimbot core enables `finalize_response` when creating channel runtimes.
- [x] 3.2 Update core Agent creation to enable the runtime terminal tool by default.
- [x] 3.3 Verify assistant text is still rendered while terminal tool results are not rendered as chat text.

## 4. MemOS Client Foundation

- [x] 4.1 Define `MemosClientConfig` and Koishi schema for API key, base URL, memory scope, search tuning, async write mode, tags, and raw identity metadata opt-in.
- [x] 4.2 Implement a small MemOS HTTP client for `POST /search/memory` and `POST /add/message` with timeout, headers, content type, response validation, and sanitized errors.
- [x] 4.3 Implement stable short hash helpers for group channel identity, private author identity, conversation identity, agent identity, and safe source metadata.
- [x] 4.4 Add tests for config defaults, missing API key behavior, identity hashing, and sanitized diagnostics.

## 5. MemOS Tools and Prompt Policy

- [x] 5.1 Add tests for `search_message` schema, request body construction, normalized output, and fail-open error result.
- [x] 5.2 Implement `search_message(query)` using runtime-filled MemOS fields and configured search defaults.
- [x] 5.3 Add tests for `add_message` schema, runtime-wrapped `content`, safe metadata, async mode, and fail-open error result.
- [x] 5.4 Implement `add_message(content)` with no LLM-visible runtime fields.
- [x] 5.5 Implement the MemOS Agent plugin registration with only `search_message` and `add_message`.
- [x] 5.6 Extend the system prompt with search-before-answer, selective write-after-answer, sensitive-data avoidance, and `finalize_response` completion instructions.

## 6. Verification and Documentation

- [x] 6.1 Run focused type checks/tests for `@yesimbot/agent-runtime`, `koishi-plugin-yesimbot`, and `koishi-plugin-yesimbot-memos-client`.
- [x] 6.2 Run `openspec validate integrate-memos-cloud-memory --json` and fix any artifact issues.
- [x] 6.3 Document no-key local verification and optional live MemOS add/search verification when `MEMOS_API_KEY` starts with `mpg-`.
- [x] 6.4 Record any remaining architecture gaps, especially current-turn platform context access and future internal full-turn memory ingestion.
