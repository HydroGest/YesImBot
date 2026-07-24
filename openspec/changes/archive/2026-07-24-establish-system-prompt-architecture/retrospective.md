# Retrospective: establish-system-prompt-architecture

> Written: 2026-07-24 after verification passed.
> Commit range: `21fbc62..62282e5`
> Worktree: `/home/workspace/YesImBot`

## 0. Evidence

- **Commit range**: `21fbc62..62282e5` (10 commits).
- **Diff size**: `+1370/-725` across 36 files.
- **Tasks done**: 19/19.
- **Active time**: about three hours of implementation and verification work.
- **Subagent dispatches**: 7 worker or reviewer sessions during apply; none during archive.
- **New external dependencies**: none.
- **Bugs found during completion**: 2: a stale append-hook assertion and mutable stable-resource ownership exposed by final review.
- **OpenSpec validation**: `openspec validate --all --json` passed 17/17 items at archive verification.
- **Test signal**: fresh root test ran 36 successful Turbo tasks; Agent runtime 82 tests, Core 183 tests, MemOS 31 tests.

Commit chain:

```text
227d4f2 refactor(agent-runtime): freeze plugin prompt and tool resources
301d6ae refactor(agent-runtime): freeze agent model system and tools
096537f feat(core): build immutable channel prompt snapshots
0795f23 feat(core): add non-destructive channel runtime reload
f8591ba refactor(memos): align memory policy outcomes and scope
4620c50 test(agent-runtime): align append initialization expectation
cf33790 docs(agent-runtime): remove obsolete mutable API
2d7bbdf docs(openspec): record system prompt cutover
183a926 fix(agent-runtime): harden immutable resource initialization
62282e5 docs: align runtime lifecycle guidance
```

## 1. Wins

- The immutable resource lifecycle landed in focused commits and retained direct regression coverage for Agent, Core, and MemOS behavior.
- The single final review found lifecycle ownership gaps before archive. Commit `183a926` fixed both the cleanup sequence and external mutable-reference exposure.
- Fresh root verification covered all workspace test packages after the review fixes.

## 2. Misses

- 🟡 The final workspace run exposed a stale assertion in `packages/agent-runtime/tests/append.test.ts`; commit `4620c50` corrected the test to account for one-time stable initialization.
- 🟡 The original final review found that cleanup errors could stop later plugin cleanup and that stable resources retained caller-owned mutable references; commit `183a926` addressed both issues.
- 📌 `plan.md` lacked a closing code fence, which prevented `task-brief` from recognizing later tasks until the fence was restored.

## 3. Plan Deviations

| Plan task | What changed | Why |
|---|---|---|
| Task 2 | Updated an append test after full workspace verification | Stable `extendTools` initialization changed the old assertion's premise. |
| Final review | Added ownership and cleanup regression tests | Review identified requirements that focused task checks had not fully covered. |
| Task extraction | Added one closing Markdown fence to `plan.md` | The missing fence blocked the required task-brief workflow. |

## 4. Skill And Workflow Compliance

| Skill | Used |
|---|---|
| `brainstorming` | ✓ |
| `writing-plans` | ✓ |
| `subagent-driven-development` | ✓ |
| `test-driven-development` | ✓ |
| `requesting-code-review` | ✓ |
| `verification-before-completion` | ✓ |

### Deliberately Skipped Skills

- **`using-git-worktrees`**
  - **What was skipped**: worktree creation.
  - **Why this cycle**: the user required direct work in `/home/workspace/YesImBot` and prohibited a worktree.
  - **How to prevent recurrence**: one-off schema boundary case; direct-worktree execution was an explicit user instruction.

## 5. Surprises

- The initial final review showed that copying arrays alone did not establish ownership of system blocks, provider options, and tool descriptors.
- The schema required `verify.md` and `retrospective.md` before archive even though the completed apply cycle intentionally omitted them.

## 6. Promote Candidates

- [ ] 🟡 **Treat stable resource snapshots as owned values, not copied containers.**
  → **Promote to** project memory
  > **Why**: final review found external mutation paths after shallow registry copies.
  > **How to apply**: when a lifecycle cache freezes configuration, copy JSON-compatible nested values and capture callable descriptors at initialization.

- [ ] 📌 **Validate plan Markdown fences before task extraction.**
  → **Promote to** schema or planning skill
  > **Why**: a missing fence made the required task extractor skip later plan tasks.
  > **How to apply**: run a Markdown fence sanity check before generating per-task briefs.
