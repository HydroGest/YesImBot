# Retrospective: simplify-platform-adapter-model

> Written: 2026-07-20 (after verify passed with warnings)
> Commit range: `6daa9c6..e6d7322` plus corrective worktree changes
> Worktree: `/home/workspace/YesImBot` (uncommitted implementation)

---

## 0. Evidence

- **Commit range**: `6daa9c6..e6d7322` (7 implementation commits) plus uncommitted corrective and documentation changes in the current worktree.
- **Diff size**: `+6,664 / -5,570` lines across 80 in-scope files relative to `6daa9c6`, including 21 untracked files and excluding `.superpowers/` process output and the unrelated `design-platform-adapter-system/HANDOFF.md` deletion.
- **Tasks done**: 11/11 (`tasks.md` has 11 checked task items)
- **Active hours**: about 4 active hours across implementation, final review, and repairs on 2026-07-20.
- **Subagent dispatches**: 16 productive dispatches: 4 read-only explorations, 1 architecture preflight, 7 implementation/verification phases, 1 final review, 2 repair passes, and 1 repair verification.
- **New external dependencies**: none (`proposal.md`, `review-fix-verify.md`)
- **Bugs encountered post-merge**: none; the change has not merged (`review-fix-verify.md`)
- **OpenSpec validate state at archive**: pass before archive (`rtk openspec validate "simplify-platform-adapter-model" --type change --strict --no-interactive`)
- **Test coverage signal**: root tests passed 39/39 tasks; focused repair suites passed: Memos 4, core 46, lifecycle 11, OneBot prepare 12, and OneBot utils 15 (`review-fix-verify.md`)

Commit chain:

```text
9082ca8 refactor(core): pure-data platform message with elements
f875902 refactor(core): draft elements and publish-only events
d32e587 feat(core): normalize elements and project platform messages
59a032f refactor(core): prepare images via ImagePrepareSink
8c5fa2f fix(core): serialize platform message lifecycle and purge dead modules
5077e01 refactor(plugins): OneBot prepare, reaction events, and paginated forward tool
e6d7322 refactor: simplify platform adapter model — all tasks complete
WORKTREE corrective implementation, final-review repairs, and archive documentation
```

---

## 1. Wins

- [evidence: `core/src/platform/types.ts`, `core/tests/platform-types.test.ts`, `core/tsconfig.type-tests.json`] The public boundary separates `Platform.Message` from its literal `Platform.MessageRecord`, uses Koishi `Element[]`, and type-checks negative public-contract assertions.
- [evidence: `core/src/platform/service.ts`, `core/src/runtime/service.ts`, `core/tests/channel-lifecycle.test.ts`, `core/tests/reset.test.ts`] Platform collection, preparation, final busy-state read, initial submission, and reset share a per-channel FIFO; model-stream consumption stays outside that queue.
- [evidence: `platforms/onebot/src/prepare.ts`, `platforms/onebot/tests/prepare.test.ts`] OneBot preparation traverses nested image nodes, limits the first four nodes, caps concurrent downloads at two, enforces byte limits, and aborts timed-out or oversized reads.
- [evidence: `plugins/onebot-utils/src/index.ts`, `plugins/onebot-utils/tests/onebot-utils.test.ts`] The forward tool accepts raw text and structured segments, returns bounded text-only pages, and removes URLs, asset IDs, raw fields, and child IDs.
- [evidence: `.superpowers/sdd/repair-verification-report.md`] The repair passes addressed all 10 final-review findings before this retrospective: six Important findings and four Minor findings.

## 2. Misses

- 🟡 [painful | evidence: `review-fix-verify.md:8-13`, `.superpowers/sdd/repair-verification-report.md:41-44`] Root `yarn fmt:check` still fails on range-external `core/src/config.ts` and `core/src/runtime/index.ts`; the change did not modify those files.
- 📌 [nit | evidence: `git status --short`, §0] The corrective implementation and repairs remain uncommitted; archive can proceed, but merge or release still needs an explicit commit decision.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Final verification | Recorded `DONE_WITH_CONCERNS` rather than an unconditional pass. | Root formatting still reports two range-external source files; lint, type checks, build, tests, strict validation, and diff checks passed. |
| Final-review remediation | Added Repairs A and B after the initial review. | The final reviewer found 10 concrete contract, consumer, image, FIFO-coverage, cleanup, and typing defects; the repairs added focused regressions and implementation fixes. |
| Worktree and commits | Used the current checkout and left changes uncommitted. | The user explicitly required no worktree and no commit. |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming | ✓ |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✗ |
| superpowers:subagent-driven-development | ✓ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✗ |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: Creating an isolated worktree.
  - **Why this cycle**: The user explicitly required that this cycle not use a worktree; `review-fix-plan.md:14-17` preserved that constraint.
  - **How to prevent recurrence**: `scope-judgment rule` — record an explicit user override in verification and work from the current checkout without classifying it as an implementation defect.

- **`superpowers:finishing-a-development-branch`**
  - **What was skipped**: Commit, merge, or PR finishing flow.
  - **Why this cycle**: The user prohibited commits, and `git status --short` confirms the implementation remains in the worktree.
  - **How to prevent recurrence**: `scope-judgment rule` — enter branch-finishing flow only after the user requests integration and authorizes the resulting external state change.

## 5. Surprises

- [evidence: `.superpowers/sdd/final-review-report.md`, `.superpowers/sdd/repair-a-report.md`, `.superpowers/sdd/repair-b-report.md`] Passing the first full pipeline did not expose the stale Memos consumer, unchecked type fixtures, mixed image-node cutoff, or string-valued OneBot forward input. Focused producer-to-consumer and negative-contract tests exposed those gaps.
- [evidence: `core/tests/channel-lifecycle.test.ts`, `.superpowers/sdd/repair-b-report.md`] A same-channel FIFO test does not prove cross-channel concurrency; the repair needed separate preparation gates to test the queue-key boundary.
- [evidence: `core/src/platform/assets.ts`, `core/tests/platform-assets.test.ts`] A prefix check looked sufficient until the wrong-tail PNG and failed temporary-write cases exercised the byte-validation and cleanup boundaries.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Run producer-to-consumer tests when a custom-message record changes** → **Promote to project AGENTS.md**
  > **Why**: The platform producer changed to `MessageRecord`, while Memos still consumed removed nested fields until the final review found the regression.
  > **How to apply**: When changing an `AgentCustomMessages` payload, identify each consumer and add at least one current-shape integration fixture before final verification.

- [ ] 🟡 **Compile negative TypeScript assertions in a dedicated no-emit target** → **Promote to project AGENTS.md**
  > **Why**: Vitest transpilation did not validate `@ts-expect-error` public-boundary tests.
  > **How to apply**: When a public TypeScript contract adds negative assertions, include its type-test configuration in the package `check-types` command.

- [ ] 📌 **Exercise boundary mixtures, not only homogeneous inputs** → **Promote to one-off**
  > **Why**: Five remote images did not test the required cutoff across local, unavailable, and source-less image nodes.
  > **How to apply**: For ordered resource limits, include mixed eligible and ineligible inputs in the focused regression suite.
