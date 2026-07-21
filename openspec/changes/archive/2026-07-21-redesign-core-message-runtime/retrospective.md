# Retrospective: redesign-core-message-runtime

> Written: 2026-07-21 (after verify passed)
> Commit range: `ba1fc33..23607ac`
> Worktree: `/home/workspace/YesImBot`

---

## 0. Evidence

- **Commit range**: `ba1fc33..23607ac` (2 commits before archive)
- **Diff size**: +2023 / -1192 lines across 30 files
- **Tasks done**: 9/9
- **Active hours**: about 2 hours, excluding the recorded 4h14 idle gap
- **Subagent dispatches**: n/a
- **New external dependencies**: none
- **Bugs encountered post-merge**: none; the change has not been merged
- **OpenSpec validate state at archive**: pass, 17/17 items valid
- **Test coverage signal**: core Vitest 20 files / 115 tests

Commit chain:

```text
ba1fc33 chore(openspec): add runtime spec
f1a607d refactor(core): redesign message runtime
23607ac chore(openspec): sync runtime specs
(archive) chore(openspec): archive core runtime redesign
```

---

## 1. Wins

- [evidence: `f1a607d`, `core/src/runtime/channel-runtime.ts`] One deep module now owns per-channel FIFO submission, stream consumption, reset, and stop.
- [evidence: `core/tests/channel-runtime.test.ts`, 15 tests] Focused tests cover post-prepare busy reads, atomic join/run submission, queue recovery, reset interleaving, self-ignore, stream ownership, and teardown failures.
- [evidence: `core/src/delivery/service.ts`, `core/tests/delivery.test.ts`] Delivery uses Koishi Session/Bot primitives and preserves ordered `string[]` receipts without a platform delivery adapter.
- [evidence: final engineering review APPROVED] The implementation resolved every blocking review finding before archive.

## 2. Misses

- 🟡 [painful | evidence: `core/src/delivery/service.ts`] Delivery tests passed before type-checking exposed a definite-assignment error; the completion gate caught it before commit.
- 🟡 [painful | evidence: `core/tests/channel-runtime.test.ts:313`] The first atomic-submission test could pass after an inserted microtask yield. Operation-order assertions and a temporary mutation test replaced it.
- 📌 [nit | evidence: `core/tests/channel-lifecycle.test.ts`] The first service facade pass omitted the reset command disposer. Final review added an exactly-once cleanup assertion.

## 3. Plan Deviations

| Plan task | What changed | Why |
| --- | --- | --- |
| Task 4 | Added sender-resolution ordering and TypeScript control-flow fixes | Missing-target delivery with empty output and the type-only build path needed explicit coverage. |
| Task 7 | Added best-effort teardown diagnostics and failure isolation | Final review found that one rejected Agent teardown could skip later cleanup. |
| Task 8 | Added command disposal and stronger deep-module regression tests | Service cleanup and atomic-submission coverage were incomplete in the first integration pass. |

## 4. Skill / Workflow Compliance

| Skill | Used |
| --- | --- |
| superpowers:brainstorming | ✓ (existing `brainstorm.md`) |
| superpowers:writing-plans | ✓ (existing `plan.md`) |
| superpowers:using-git-worktrees | ✗ |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✓ |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: worktree creation and worktree cleanup.
  - **Why this cycle**: the downstream execution prompt explicitly required shared-workspace execution without a worktree and serialized every mutation-capable worker.
  - **How to prevent recurrence**: one-off - schema boundary case, no prevention possible because direct user instructions override the workflow default.

## 5. Surprises

- Koishi's type-only `Delivery` namespace needed a type-only re-export; a value export passed TypeScript analysis but failed bundling.
- A test that asserted only `send()` selection did not prove the no-await invariant. Recording `busy.read -> send/run -> microtask` made the invariant observable.
- The repository has only `origin/dev`, so the verify precheck could not derive a baseline from `origin/main` or `origin/master`; `f1a607d^` supplied the implementation baseline.

## 6. Promote Candidates -> Long-Term Learning

- [ ] 🟡 **Mutation-check concurrency tests that claim a no-await invariant** -> **Promote to project agent guide**
  > **Why**: the first atomic-submission test stayed green after a microtask yield and did not protect the stated contract.
  > **How to apply**: when a test claims two operations have no await between them, temporarily insert a yield and require the test to fail before accepting coverage.

- [ ] 📌 **Allow verify baseline fallback to the implementation parent when main refs do not exist** -> **Promote to OpenSpec verify skill**
  > **Why**: this repository exposes `origin/dev` but no `origin/main` or `origin/master`, making the standard precheck report zero commits.
  > **How to apply**: detect the current upstream or require an explicit baseline before treating a zero main-range count as missing implementation evidence.
