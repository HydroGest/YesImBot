# Retrospective: compose-agent-turns

## Cycle metadata

- **Change**: `compose-agent-turns`
- **Schema**: `superpowers-bridge`
- **Date**: 2026-07-11
- **Commit range**: none (implementation left uncommitted by repo rule)
- **Diff size**: uncommitted dirty set across runtime + core (~13 tracked files modified)
- **Tasks done**: 18/18
- **Active hours**: ~1 session
- **Subagent dispatches**: n/a (not used)
- **New external dependencies**: none
- **Bugs encountered post-merge**: none (not merged)
- **OpenSpec validate state at archive prep**: pass (`openspec validate --all --json` → 12/12)
- **Test coverage signal**: `@yesimbot/agent-runtime` 74 passed; `koishi-plugin-yesimbot` 42 passed; package typechecks passed

Commit chain:

```text
No change commit was created in this cycle.
```

---

## 1. Wins

- [evidence: `packages/agent-runtime/src/turn.ts`, `packages/agent-runtime/tests/turn.test.ts`] Turn control now owns idle `wait`, abort, and busy enqueue in one place instead of splitting wait/result retention across agent + queue.
- [evidence: `packages/agent-runtime/src/agent.ts`, `core/src/service.ts`] Process path is event-first (`run` stream) without inventing `observe()` or a Runner abstraction.
- [evidence: runtime/core test suites] Breaking API migration (`waitTurn` → `wait` / stream consumption) was completed with full package-scoped green tests.
- [evidence: design/specs] Exploration locked the hard constraints early (no Runner, no new files, plan A event membership, apeira-like idle wait), which kept implementation scoped.

## 2. Misses

- 📌 [nit | evidence: `verify.md`, git status] Implementation remains uncommitted, so archive/PR readiness still depends on an explicit commit step.
- 📌 [nit | evidence: apply instructions vs user request] Schema-default worktree/subagent loop was skipped; isolation and review rigor therefore relied on local sequential execution.
- 🟡 [painful | evidence: bulk test rewrite] Initial mechanical `waitTurn` → `wait` replacement left broken assumptions (`result.status`, retained results). Required a second pass to rewrite assertions around events/storage/idle wait.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| using-git-worktrees | Implemented in current workspace, no worktree | User explicitly requested no worktree for this apply |
| subagent-driven-development | Manual sequential implementation | User requested direct execution; coupled runtime/core/API surface made single-thread edits safer |
| commit checkpoints | No commits | Repo rule: do not commit unless explicitly asked |
| core busy tracking | Kept `activeTurns` marker map rather than fully deleting it | Minimal migration; `run` path now owns busy lifetime, full `isIdle()`-only routing deferred |
| TurnNotFoundError | Removed with wait-path bookkeeping | No remaining callers after `waitTurn` deletion |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming / opsx-explore | ✓ |
| superpowers:writing-plans / opsx-propose artifacts | ✓ |
| superpowers:using-git-worktrees | ✗ |
| superpowers:subagent-driven-development | ✗ |
| (transitive) superpowers:test-driven-development | ~ partial |
| (transitive) superpowers:requesting-code-review | ✗ |
| superpowers:finishing-a-development-branch | ✗ |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: isolated git worktree creation.
  - **Why this cycle**: user explicitly said “本次不使用worktree”.
  - **How to prevent recurrence**: scope-judgment rule — honor explicit user override of schema worktree default and record it in verify/retrospective.

- **`superpowers:subagent-driven-development`**
  - **What was skipped**: fresh implementer subagents per task + per-task review/commit loop.
  - **Why this cycle**: user asked to apply directly; public API rename touched many tightly coupled tests/call sites that benefit from one coherent edit pass; commit checkpoints were disallowed.
  - **How to prevent recurrence**: schema graph fix / scope-judgment rule — allow a documented “direct apply, no commit” path for experimental monorepo API migrations when the user opts out of worktree/SDD.

- **`(transitive) superpowers:test-driven-development`**
  - **What was skipped**: strict RED-before-green for every microtask.
  - **Why this cycle**: migration was primarily API rewrite against an existing large suite; tests were migrated with implementation and then used as the green gate.
  - **How to prevent recurrence**: for pure API renames, prefer first converting tests to the new contract (expected fail) then flipping implementation in a dedicated step when time allows.

- **`(transitive) superpowers:requesting-code-review`**
  - **What was skipped**: dedicated reviewer subagent after each task / final review dispatch.
  - **Why this cycle**: no subagent apply loop; verification relied on package tests + openspec validate + manual design/spec coherence check in verify.md.
  - **How to prevent recurrence**: if SDD is skipped, still request one end-of-cycle review pass when user wants higher assurance before archive.

- **`superpowers:finishing-a-development-branch`**
  - **What was skipped**: commit/PR/archive finishing flow.
  - **Why this cycle**: user asked only for verify + retrospective; no commit/archive instruction yet; worktree dirty.
  - **How to prevent recurrence**: scope-judgment rule — run finishing only after explicit user request once verify is non-blocking.

## 5. Surprises

- Expanding `run()` membership was smaller than expected: switching from `turn.*` prefix checks to any event carrying `turnId` was enough for plan A.
- The painful part was not queue composition, but the test corpus still thinking in `TurnResult` terms after `wait()` became `void`.
- Core service became clearer with `const stream = runtime.run(...)` than with `send + waitTurn`, matching the earlier readability concern without needing `observe()`.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **API-migration tests should drop result-object assumptions before implementation flips** → **Promote to project CLAUDE.md / agent guide**
  > **Why**: bulk replacing `waitTurn` with `wait` left many `result.status` / `result.messages` assertions broken and required a cleanup pass.
  > **How to apply**: for wait/result API changes, rewrite tests to events/storage/idle barriers first, then change production API.

- [ ] 📌 **Honor explicit “no worktree / no commit” apply overrides in verify language** → **Promote to schema/process note**
  > **Why**: superpowers-bridge apply instructions assume worktree + SDD + commits, but this repo often forbids unsolicited commits and the user may opt out of worktrees.
  > **How to apply**: when overridden, mark verify as PASS WITH WARNINGS and document skipped skills instead of forcing schema path.

- [ ] 📌 **Keep process-path readability via local stream variable, not new observe APIs** → **One-off / design preference**
  > **Why**: `const stream = runtime.run(message)` solved the “run(message) feels odd” concern without new surface area.
  > **How to apply**: prefer call-site structure over new helper APIs for one-shot stream consumption.

## 7. Follow-ups

1. Commit the implementation when requested.
2. Optional later cleanup: derive core busy routing from `runtime.isIdle()` and delete residual `activeTurns` marker semantics if still redundant.
