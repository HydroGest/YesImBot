## 1. Runtime Retrieval Safeguards

- [x] 1.1 Keep `search_message` LLM input limited to `query` while applying code-owned MemOS filters.
- [x] 1.2 Preserve safe rich MemOS search result metadata for imported and live memories.
- [x] 1.3 Keep imported historical memory prompt policy scoped to same-context, same-subject use.

## 2. Standalone Import Script

- [x] 2.1 Replace old reviewed-batch import tests with synthetic-fixture tests for the standalone package-local TypeScript script.
- [x] 2.2 Implement single-entry CLI parsing with `--input`, required `--bot-self-id`, `--dry-run`, `--debug`, chunk flags, `--async-mode`, and `--base-url`.
- [x] 2.3 Implement explicit JSON file input and non-recursive directory scanning without embedded default paths.
- [x] 2.4 Implement QQ export parsing, explicit bot role mapping, deterministic filtering, and de-duplication.
- [x] 2.5 Implement configurable chunking with defaults `16000` estimated tokens, `400` messages, `168` hours, and `0` overlap messages.
- [x] 2.6 Implement MemOS `add_message` request construction with system source context, per-message `chat_time`, role mapping, tags, info, source, and async mode.
- [x] 2.7 Ensure `--dry-run` never calls MemOS and live import requires `MEMOS_API_KEY`.

## 3. Old Workflow Removal

- [x] 3.1 Delete old LLM review, review prompt, review result, approval, batch state, approved commit, and import validation source files.
- [x] 3.2 Delete old import workflow tests and remove review-model dependencies.
- [x] 3.3 Update README and OpenSpec artifacts to describe the trusted-source script flow and remove real pilot data examples.

## 4. Verification

- [x] 4.1 Run the new focused script tests.
- [x] 4.2 Run package type checks.
- [x] 4.3 Run package test suite.
- [x] 4.4 Run OpenSpec validation.
- [x] 4.5 Run targeted format checks for touched files and `git diff --check`; full `fmt:check` is blocked by unrelated pre-existing files.

## 5. Shared MemOS Identity Standard

- [x] 5.1 Add a shared `plugins/memos-client` identity helper for MemOS `user_id`, `conversation_id`, and `agent_id` generation.
- [x] 5.2 Update runtime add/search tools so writes use turn-scoped `conversation_id` and searches do not restrict by current `conversation_id` by default.
- [x] 5.3 Update QQ import script to use subject-scoped `user_id`, chunk-scoped `conversation_id`, bot-scoped `agent_id`, and no local copy of MemOS/channel hashing algorithms.
- [x] 5.4 Add tests proving imported chunk memories and runtime searches share the same subject `user_id` while using different context `conversation_id` values.
