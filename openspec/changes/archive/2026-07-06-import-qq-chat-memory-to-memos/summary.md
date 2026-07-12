This change was redirected from the old reviewed-batch import pipeline to a simpler standalone trusted-source import script.

## Current Implementation Shape

- `plugins/memos-client/scripts/qq-memos-import.ts` is now the import implementation.
- Operators run `plugins/memos-client/scripts/qq-memos-import.ts` directly with `tsx`; there is no wrapper or package script alias.
- `plugins/memos-client/src/import/*` has been removed.
- Old review/approval/import-state tests were replaced by `plugins/memos-client/tests/qq-memos-import.test.ts` with synthetic fixtures.
- Review-model dependencies were removed from `plugins/memos-client/package.json`.

## Safety Decisions

- No default input path.
- No default bot self id.
- No real group/contact examples in new script tests or OpenSpec artifacts.
- `--dry-run` is local-only and does not require MemOS credentials.
- Live import requires `MEMOS_API_KEY`.

## Verification Status

- Focused script tests passed.
- Full `koishi-plugin-yesimbot-memos-client` Vitest suite passed.
- Package type checks passed.
- OpenSpec validation passed.
- Wrapper dry-run smoke passed with synthetic `/tmp/opencode` input and no MemOS key.
- `git diff --check` passed.
- Targeted formatting for touched files passed. Full `rtk yarn fmt:check` was run and remains blocked by unrelated pre-existing formatting issues outside this change.
