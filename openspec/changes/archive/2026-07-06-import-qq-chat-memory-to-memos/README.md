# import-qq-chat-memory-to-memos

This change now tracks a standalone trusted-source QQ chat history import script for MemOS Cloud plus runtime retrieval safeguards for imported memories.

## Source of truth

- Design: `openspec/changes/import-qq-chat-memory-to-memos/design.md`
- QQ import spec: `openspec/changes/import-qq-chat-memory-to-memos/specs/qq-chat-memory-import/spec.md`
- MemOS memory spec: `openspec/changes/import-qq-chat-memory-to-memos/specs/memos-cloud-memory/spec.md`
- Tasks: `openspec/changes/import-qq-chat-memory-to-memos/tasks.md`
- Plan: `openspec/changes/import-qq-chat-memory-to-memos/plan.md`

## Default operating mode

- The script requires explicit `--input <file-or-dir>` and `--bot-self-id <id>`.
- Directory input scans only direct child `*.json` files and does not recurse.
- `--dry-run` parses, filters, de-duplicates, chunks, and prints sanitized statistics without calling MemOS.
- Live import is the same command without `--dry-run`; it requires `MEMOS_API_KEY`.
- `MEMOS_BASE_URL` may override the default MemOS Cloud URL; `--base-url` has highest priority.
- Chunk defaults are `16000` estimated tokens, `400` messages, `168` hours, and `0` overlap messages.

## Safety boundary

- No real export path, bot id, group id, group name, or contact name is embedded in the script or tests.
- Debug logs must not print API keys, Authorization headers, full request bodies, or real default inputs.
- Old review, approval, batch state, approved commit, and validation flows are deleted rather than kept as compatibility paths.
- Existing remote memories from older experiments are intentionally not handled by this script.

## Verification Notes

- Focused script tests: `rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/qq-memos-import.test.ts`.
- Package tests: `rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run`.
- Type checks: `rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot-memos-client`.
- OpenSpec validation: `rtk openspec validate import-qq-chat-memory-to-memos --json`.
- Direct `tsx` dry-run smoke: `rtk npx tsx plugins/memos-client/scripts/qq-memos-import.ts --input <synthetic-temp-dir> --bot-self-id <synthetic-id> --dry-run --debug`.
- Targeted formatting for touched files passed. Full `rtk yarn fmt:check` was also run and is blocked by unrelated pre-existing formatting issues outside this change.
- `rtk git diff --check` passed.
