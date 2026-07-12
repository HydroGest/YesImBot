## Context

Athena already has a MemOS Cloud runtime plugin that exposes narrow Agent-visible memory tools. Historical QQ import is an operator task with different constraints: it reads trusted local export files, transforms them into MemOS `add_message` requests, and must never become an Agent-triggered runtime operation.

The previous design introduced review prompts, automated review, approval state, commit state, and validation state. Testing showed that this made the workflow too complex and produced worse source material than direct raw conversation import.

## Goals / Non-Goals

**Goals:**

- Provide one standalone package-local TypeScript script file for QQ export import.
- Require explicit `--input` and `--bot-self-id`; do not embed real operator paths or IDs.
- Support single JSON input and non-recursive directory scanning of `*.json` files.
- Use `--dry-run` for parse/chunk/statistics only; live writes happen only when `--dry-run` is absent.
- Use `MEMOS_BASE_URL` / `MEMOS_API_KEY` for live MemOS writes.
- Chunk under MemOS's approximate 40k-token request limit, with conservative defaults of `16000` estimated tokens and `400` messages.
- Upload `messages` where the first message is `system`, ordinary QQ users are `user`, and bot self messages are `assistant`.
- Preserve historical `chat_time` on every uploaded message, including the system message.
- Remove old review, approval, batch state, and approved commit workflow files.

**Non-Goals:**

- Do not call a review LLM or generate review prompts.
- Do not keep compatibility with old output directories or batch state files.
- Do not delete old MemOS memories; the operator will handle existing remote data manually.
- Do not expose import as an Agent-visible tool.

## Decisions

### D1: Use a single CLI with `--dry-run`

- **Choice**: `npx tsx plugins/memos-client/scripts/qq-memos-import.ts --input <file-or-dir> --bot-self-id <id> --dry-run` performs local planning. The same command without `--dry-run` performs live writes.
- **Reason**: One command surface is easier to document and verify than subcommands plus state transitions.
- **Alternative considered**: `dry-run` / `import` subcommands. Rejected by user decision.

### D2: No embedded real operator data

- **Choice**: The script and tests must not hard-code real export paths, bot self ids, group ids, group names, or contact names.
- **Reason**: Import inputs and identities are operator data, not source code constants.
- **Alternative considered**: Keep pilot defaults. Rejected because it leaks real data and makes accidental imports more likely.

### D3: Require explicit bot self id

- **Choice**: `--bot-self-id` is mandatory and role mapping must not trust `chatInfo.selfUin`.
- **Reason**: Export metadata can be inconsistent; the operator knows which sender represents the bot.

### D4: Use deterministic local filtering only

- **Choice**: Filter system messages, empty text, recalled-without-text messages, and media/resource-only noise.
- **Reason**: These rules remove low-value artifacts without introducing subjective LLM review.

### D5: Chunk by multiple hard stops

- **Choice**: Split when any configured limit is reached: estimated tokens, message count, or time range. Defaults are `16000` estimated tokens, `400` messages, `168` hours, and `0` overlap messages.
- **Reason**: The defaults leave a conservative margin below MemOS's approximate `40000` token limit while still allowing much larger requests than the old pilot batches.
- **Alternative considered**: Add a tokenizer dependency. Rejected for v1; character-based estimation is simpler and conservative enough for dry-run inspection.

### D6: Use raw conversation messages as MemOS input

- **Choice**: Each request sends a `messages` array. The first item is a `system` source-context message with `chat_time` set to the chunk start time. User messages use `${userName}(${userId}): ${content}`. Bot self messages use role `assistant`.
- **Reason**: MemOS can infer facts from raw dialogue while preserving speaker and time context.

### D7: Keep the script independent from plugin import runtime

- **Choice**: Remove `plugins/memos-client/src/import/*`; the package-local TypeScript script owns parsing, chunking, request construction, and HTTP writes.
- **Reason**: Import is an operator workflow, not runtime plugin behavior. Keeping it independent avoids reviving the old state machine.

### D8: Standardize MemOS identity semantics across runtime and imports

- **Choice**: `plugins/memos-client` owns a shared deterministic MemOS identity helper used by runtime tools and the QQ import script. `core` keeps `createChannelScopeId()` for runtime workspace/channel keys and does not own MemOS-specific identifiers.
- **Hash primitive**: `hash22(parts) = sha256(JSON.stringify(parts)).base64url.slice(0, 22)`.
- **Subject id**: `user_id = yb_subject_${hash22(["memos-subject-v1", platform, channelType, subjectRawId])}`. `subjectRawId` is the group id for group chats and the contact user id for private chats. `user_id` MUST NOT include `selfId` because it represents the chat subject, not the bot's view of that subject.
- **Agent id**: `agent_id = yb_agent_${hash22(["memos-agent-v1", platform, selfId])}`. `selfId` belongs here because it identifies the bot/agent that wrote or searches the memory.
- **Conversation id**: `conversation_id` represents one concrete context segment, not the chat subject. Runtime writes use `yb_conv_${hash22(["memos-conversation-v1", "runtime_turn", platform, channelType, subjectRawId, turnId])}`. QQ imports use `yb_conv_${hash22(["memos-conversation-v1", "qq_import", platform, channelType, subjectRawId, chunkStartIso, chunkEndIso, firstMessageId, lastMessageId, chunkIndex])}`.
- **Search behavior**: runtime `search_message` searches by `user_id` and code-owned filters, and MUST NOT pass the current runtime `conversation_id` by default. Passing the current conversation id would prevent retrieval across imported chunk conversations.
- **Reason**: MemOS treats `user_id` as the stable end-user/chat subject and `conversation_id` as a thread/session. Aligning with that contract lets imported chunk memories and live runtime memories be searched under the same subject without collapsing all chunks into one conversation.

## Risks / Trade-offs

- [Risk] Raw chat import may include sensitive third-party context. -> Mitigation: only import trusted operator-selected files; dry-run shows counts before live writes; no default input path exists.
- [Risk] Approximate token estimates can be wrong. -> Mitigation: default to `16000`, far below MemOS's approximate `40000` limit, and allow manual lowering.
- [Risk] Async writes are not immediately searchable. -> Mitigation: expose `--async-mode true|false`; default remains async for large imports.
- [Risk] Changing MemOS identity ids can make previously imported pilot data harder to retrieve. -> Accepted; old memories are being removed manually, and the new deterministic ids are the source of truth.
- [Trade-off] Removing review state removes resume metadata. -> Accepted for KISS; reruns are deterministic and de-duplicate input messages before chunking.

## Migration Plan

1. Replace OpenSpec artifacts with the trusted-source import requirements.
2. Add synthetic-fixture tests for the new package-local TypeScript script.
3. Implement `plugins/memos-client/scripts/qq-memos-import.ts` with standalone parsing, filtering, chunking, dry-run, and HTTP import logic.
4. Run the TypeScript source directly with `tsx`; do not add a package script or `.mjs` wrapper.
5. Delete old `plugins/memos-client/src/import/*` files and old import tests.
6. Remove review-model dependencies and old README workflow documentation.
7. Standardize MemOS identity generation across runtime tools and the import script.
8. Run targeted tests, package type checks, OpenSpec validation, formatting checks, and `git diff --check`.

Rollback strategy:
- Before live import, no external state exists.
- During live import, each request uses `tags: ["yesimbot", "qq_import", "trusted_source"]` and `info.import_source = "qq_chat"`, so operator-side inspection/deletion can target imported data later.

## Open Questions

- None for v1. Directory input is non-recursive, and the system message uses chunk start time for `chat_time`.
