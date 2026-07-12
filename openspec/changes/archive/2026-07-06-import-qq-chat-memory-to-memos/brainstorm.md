Raw capture of the revised exploration for QQ chat history import into MemOS Cloud.

## Revised Problem Statement

Testing showed the reviewed-batch import flow was too complex and did not produce better MemOS source material. The import source is operator-selected and trusted, and MemOS recommends raw conversation input. The import workflow should therefore be a direct standalone script instead of a review/approval state machine.

## Confirmed User Decisions

1. Use one CLI surface controlled by `--dry-run`, not separate `dry-run` and `import` subcommands.
2. Require `--bot-self-id`; do not provide a default.
3. Do not embed real paths, real bot ids, real group ids, real group names, or real contact names in script code or tests.
4. Directory input scans direct child `*.json` files only; no recursion.
5. Keep `role: "system"` for the source-context message.
6. Set the system message `chat_time` to the chunk start time.
7. Filter deterministic noise before import.
8. Default chunk limits are `16000` estimated tokens and `400` messages.

## Architecture Direction

- Package script: `plugins/memos-client/scripts/qq-memos-import.ts`.
- Operators run the TypeScript source directly with `tsx`; there is no `.mjs` wrapper and no package script alias.
- Runtime plugin: `plugins/memos-client` remains responsible for Agent-visible `search_message` and `add_message`, not historical import state.
- Tests: one synthetic-fixture script test file under `plugins/memos-client/tests/`.

## Removed Concepts

- LLM review prompts.
- Automated review model execution.
- Review result import.
- Batch approval and `approve --all`.
- Commit-approved-batches state.
- Import validation state.
- Default pilot files.

## Remaining Safety Boundary

- `--dry-run` never calls MemOS and never requires `MEMOS_API_KEY`.
- Live import requires `MEMOS_API_KEY` and should only run after operator review of dry-run statistics.
- Debug output must remain sanitized.
