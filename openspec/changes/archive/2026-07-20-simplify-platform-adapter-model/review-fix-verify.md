# Review-Fix Verification

**Date:** 2026-07-20  
**Worktree:** uncommitted corrective implementation; the user-owned `tasks.md` change was preserved.

## Result

`DONE_WITH_CONCERNS`: the post-review remediation evidence is complete. Focused regressions, strict OpenSpec validation, root lint, type checking, build, and tests pass. The root formatter check still fails on two files outside the corrective diff:

- `core/src/config.ts`
- `core/src/runtime/index.ts`

The repository formatter fixed the three affected files reported during remediation (`core/src/platform/message.ts`, `plugins/platform-onebot/src/prepare.ts`, and `plugins/platform-onebot/tests/prepare.test.ts`). A fresh root check left only the two source files above, so this verification did not modify unrelated source files.

## Commands

| Command | Result |
| --- | --- |
| `rtk openspec validate "simplify-platform-adapter-model" --type change --strict --no-interactive` | passed: `Change 'simplify-platform-adapter-model' is valid` |
| `rtk yarn lint` | passed with existing warnings |
| `rtk yarn fmt:check` | failed only on the two unrelated source files above |
| `rtk yarn check-types` | passed: 17/17 tasks |
| `rtk yarn build` | passed: 30/30 tasks |
| `rtk yarn test` | passed: 39/39 tasks; core 18 files/89 tests, OneBot platform 3/20, OneBot utils 1/14 |
| focused core Vitest matrix | passed: 13 files/73 tests |
| focused OneBot platform suites | passed: 3 files/20 tests |
| focused OneBot utils suite | passed: 1 file/14 tests |

## Post-Review Remediation Evidence

All ten findings in `.superpowers/sdd/final-review-report.md` were re-inspected against the current implementation and focused regression coverage:

| Finding | Current trigger coverage | Fresh evidence |
| --- | --- | --- |
| Important 1 — Memos record | Consumer reads `data.sender.id` and `data.messageId` from the declared `MessageRecord`. | Memos plugin suite: 4/4 passed. |
| Important 2 — prepare mutation | Adapter receives a detached deep view; only returned elements are applied to a metadata snapshot. | Core prepare/assets/types/projection/service matrix: 46/46 passed. |
| Important 3 — first four images | Recursive image enumeration applies the cutoff before remote-source filtering. | OneBot prepare suite: 12/12 passed. |
| Important 4 — PNG signature | Detection checks all eight PNG signature bytes. | Core prepare/assets/types/projection/service matrix: 46/46 passed. |
| Important 5 — forward string | Usable `raw_message`, then string `message`, then segment arrays follow the local sanitizer. | OneBot utils suite: 15/15 passed. |
| Important 6 — type tests | `core/tsconfig.type-tests.json` is included by core `check-types`; negative public-boundary assertions compile. | `rtk yarn workspace koishi-plugin-yesimbot run check-types` passed. |
| Minor 1 — FIFO races | Same-channel join and cross-channel concurrent preparation have deterministic lifecycle tests. | Core message-flow/lifecycle suite: 11/11 passed. |
| Minor 2 — asset cleanup | Both temporary write and rename are inside `try`/`finally` cleanup. | Core prepare/assets/types/projection/service matrix: 46/46 passed. |
| Minor 3 — constructor seam | `PlatformService` exports only `(ctx, config)`; test control remains in helpers. | Core prepare/assets/types/projection/service matrix: 46/46 passed. |
| Minor 4 — projection assertion | Projection returns `UserModelMessage` directly with SDK-derived content parts. | Core prepare/assets/types/projection/service matrix: 46/46 passed. |

Fresh commands after scoped formatting:

| Command | Result |
| --- | --- |
| `rtk openspec validate "simplify-platform-adapter-model" --type change --strict --no-interactive` | passed: `Change 'simplify-platform-adapter-model' is valid` |
| `rtk yarn workspace koishi-plugin-yesimbot-memos-client exec vitest run tests/plugin.test.ts` | passed: 1 file, 4 tests |
| `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/platform-types.test.ts tests/platform-exports.test.ts tests/platform-prepare.test.ts tests/platform-assets.test.ts tests/platform-projection.test.ts tests/platform-service.test.ts` | passed: 6 files, 46 tests |
| `rtk yarn workspace koishi-plugin-yesimbot exec vitest run tests/message-flow.test.ts tests/channel-lifecycle.test.ts` | passed: 2 files, 11 tests |
| `rtk yarn workspace koishi-plugin-yesimbot-platform-onebot exec vitest run tests/prepare.test.ts` | passed: 1 file, 12 tests |
| `rtk yarn workspace koishi-plugin-yesimbot-onebot-utils exec vitest run tests/onebot-utils.test.ts` | passed: 1 file, 15 tests |
| `rtk yarn lint` | passed with existing warnings |
| `rtk yarn fmt:check` | failed only on the two unrelated source files above |
| `rtk yarn check-types` | passed: 17/17 tasks |
| `rtk yarn build` | passed with existing package-export warnings |
| `rtk yarn test` | passed |
| `rtk git diff --check` | passed |

## Post-Review Static Boundary Audit

- Legacy-name scan found only intentional `@ts-expect-error` negative contract assertions and a core-private `AssetStore` test import; no removed public boundary was restored.
- No `currentTurnId`, `createMessageRoute`, `platformService`, production `as any`, or public `AssetStore`/`IMAGE_BUDGET` import remains in the audited platform, OneBot, or Memos paths.
- The current `handleSession()` implementation performs its final `getActiveTurnId()` read after preparation and immediately before `send(join)` or `run()` within the per-channel FIFO.

## Static Boundary Audit

- Removed legacy names, `currentTurnId`, duplicate plugin service paths, stale normalize imports, and public asset/budget exports: absent from production boundary scans.
- `AssetStore` and `IMAGE_BUDGET` remain private implementation details in `core/src/platform`.
- Event subscribers are notified only by `publish()` and `refine()` event results; ordinary messages remain in the Session weak association.
- `prepareMessage()` uses the Session-cached adapter state; selection occurs only in collection.
- The final busy read follows preparation and immediately precedes `send(join)` or `run()` inside the channel FIFO.
- Projection reads only channel-local assets; HTTP I/O occurs only in OneBot preparation.
- OneBot forward output is sanitized to text and its tests cover raw and structured inputs.
- `core/README.md` now directs operators to remove or replace incompatible history; code has no legacy reader or migration path.

## Verification Repair

- Added `core/tests/apply.test.ts`, covering real `apply()` construction, public `ctx.yesimbot.platform`, and first-message runtime submission.
- Added the history upgrade instruction to `core/README.md`.
- Ran the repository formatter over current implementation files reported by the root format check.

## Known Warnings And Risks

- Build warnings about missing `core/src/shared/index` export targets and mixed default/named provider exports predate this verification and did not fail builds.
- Lint emits non-fatal pre-existing and test-style warnings.
- Root formatting remains a concern until the two unrelated source files are formatted by their owners.
- Build continues to warn about missing `core/src/shared/index` export targets; this pre-existing warning does not fail the build.
