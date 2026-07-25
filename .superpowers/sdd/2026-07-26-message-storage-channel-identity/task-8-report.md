# Task 8 Report: Integrate, Document, And Verify The Clean Break

## Scope

- Added a Gateway -> RuntimeManager -> ChannelRuntime -> JSONL integration scenario for an ordinary message, its sibling `delivery.failed` event, restart replay, model projection from frozen text, and clean-break preservation of an old hash directory.
- Updated the service storage facade expectation to distinguish `channelIdentity` from a readable directory name.
- Updated the project, Core, and developer architecture documentation plus one concise architecture decision-log entry.
- No production integration defect was found or changed.

## Red-Green Evidence

Before edits, `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts` failed as intended: `service.ensureStorage()` returned `channels/v1-shared-onebot-123456/workspace` while the stale test expected the 26-character identity as a directory name.

After replacing that expectation and adding the end-to-end scenario, the first run exposed an incomplete test logger fixture and then a fixture sender-format expectation. Those test-fixture issues were corrected without production changes. `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/service.test.ts tests/gateway-delivery.test.ts` then passed with 21 tests.

## Focused Suites

- `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/event.test.ts tests/gateway.test.ts tests/gateway-delivery.test.ts tests/formatter.test.ts tests/channel.test.ts tests/storage.test.ts tests/jsonl-storage.test.ts tests/channel-runtime.test.ts tests/runtime-manager.test.ts tests/service.test.ts tests/will.test.ts tests/platform/onebot.test.ts`: 256 passed; three pre-existing OneBot reaction-expectation failures remained:
  - `produces a typed reaction event from a valid reactions-updated notice`
  - `preserves numeric protocol identifiers and zero reaction counts`
  - `resolves a supported notice before considering the optional message base`
- `rtk yarn workspace koishi-plugin-yesimbot-workspace exec vitest run tests/plugin.test.ts`: 8 passed.
- `rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/plugin.test.ts tests/identity.test.ts tests/qq-memos-import.test.ts`: 19 passed.

## Static Checks And Build

- `rtk yarn lint`: exited 0, with pre-existing repository warnings.
- `rtk yarn fmt:check`: failed on 16 pre-existing files, including generated/user-owned `prompt-enhancer.html` and unrelated Core source/tests. The two changed TypeScript files were formatted and `rtk yarn exec oxfmt --check core/tests/gateway-delivery.test.ts core/tests/service.test.ts` exited 0.
- `rtk yarn check-types`: exited 0 (15 tasks successful).
- `rtk yarn build`: exited 0 (26 tasks successful).
- `lsp_diagnostics` could not run because the TypeScript language server is not installed and prior user policy declined installation.
- `bun /root/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/dist/skills/programming/scripts/typescript/check-no-excuse-rules.ts core/tests/gateway-delivery.test.ts core/tests/service.test.ts`: no violations.

## Full Baseline

`rtk yarn test` had five Core failures:

- The same three pre-existing OneBot reaction-expectation failures listed above.
- Two stale `core/tests/asset.test.ts` expectations still hard-code old 26-character hash storage directories and collision behavior. They are direct Task 5 clean-break test debt, outside the Task 8 allowed file list; no compatibility fallback was added and no out-of-scope test was modified.

All Task 8 modified suites passed during the full run.

## Audits

- `rtk rg -n 'channelKey|channels\.json|"yesimbot\.event".*message|data\.message|data\.content' core/src plugins/*/src plugins/*/scripts README.md core/README.md plugins/*/README.md AGENTS.md` returned only reviewed legitimate references: documentation explicitly states `channels.json` is not created, `input.data.messageId` is the current message field, and formatter output uses the current message ID.
- `rtk rg -n 'channel_v2_|workspace_v2_|ch_v1_|migrate|legacy.*fallback' core/src plugins/*/src` returned no matches.
- `GIT_MASTER=1 git diff --check` exited 0.

## Review And Boundaries

The requested consolidated subagent review was not dispatched because the task explicitly forbids subagents. No production source change was needed. The added test owns integration persistence behavior; the existing oversized test file remains constrained by the allowed Task 8 file list, so no out-of-scope test-module split was performed.

## Architectural Review

- Single responsibility: the new test covers the persisted input integration boundary; documentation files describe current architecture only.
- Boundary purity: no production boundary changed; test fixtures use the existing typed InputRecord contracts.
- Variant handling: assertions distinguish `yesimbot.message` and `yesimbot.event` by their current discriminants and fields.
- Escape hatches and defensive layers: no production escape hatch or compatibility fallback was added; the changed test files pass the no-excuse audit.
- Regression coverage: the stale service directory expectation failed before correction, and the new end-to-end scenario exercises message/event persistence, restart, projection, Manifest indexing, absence of `channels.json`, and old-directory preservation.

## Correction Round: Asset Storage Expectations

Controller verification found two blocking stale assertions in `core/tests/asset.test.ts`. The first hard-coded the former 26-character identity directory instead of following the `ChannelStorage` Manifest record. The second used `room?a` and `room/a`, which deliberately encode to the same readable directory and now correctly fail with a storage integrity mismatch.

The correction keeps production code unchanged. The asset round-trip now obtains the current `ChannelRecord`, verifies its stable identity and readable `v1-shared-onebot-room_42` directory, then checks the asset beneath that Manifest-backed directory. The isolation case now uses non-colliding sibling `room-42` and `room-43` scopes.

- `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/asset.test.ts`: 2 passed.
- `rtk yarn test`: 294 passed and exactly the three accepted stale OneBot reaction failures remain in `core/tests/platform/onebot.test.ts`:
  - `produces a typed reaction event from a valid reactions-updated notice`
  - `preserves numeric protocol identifiers and zero reaction counts`
  - `resolves a supported notice before considering the optional message base`
- `rtk yarn exec oxfmt --check core/tests/asset.test.ts`: exited 0.
- TypeScript LSP diagnostics remain unavailable because the server is not installed and prior user policy declined installation.
- The TypeScript no-excuse audit for `core/tests/asset.test.ts` reported no violations.
