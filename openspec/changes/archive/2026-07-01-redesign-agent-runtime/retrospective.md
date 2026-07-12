# Retrospective: redesign-agent-runtime

> Written: 2026-07-01 (after verify passed)
> Commit range: `c59d1894..57211c81` for the user-approved `origin/dev` equivalent baseline; path-limited implementation evidence is `57211c81`.
> Worktree: `/home/workspace/Athena`

---

## 0. Evidence

- **Commit range**: `c59d1894..57211c81` against `origin/dev`; path-limited change evidence contains 1 commit: `57211c81 feat(agent-runtime): add experimental runtime package`.
- **Diff size**: 6360 insertions across 44 files for `packages/agent-runtime`, `package.json`, `yarn.lock`, and `openspec/changes/redesign-agent-runtime`.
- **Tasks done**: 25/25 (`tasks.md` contains 25 checked tasks and no unchecked tasks).
- **Active hours**: not measured in machine-readable logs.
- **Subagent dispatches**: not fully reconstructable from Git; session records include implementation/review/repair delegation before this retrospective, plus verify-only review delegation.
- **New external dependencies**: no new dependency family relative to existing repo packages; `@yesimbot/agent-runtime` reuses `ai@^6.0.0`, `@ai-sdk/provider-utils@^4.0.0`, `zod@^3.25.76`, and `vitest@^4.0.18`.
- **Bugs encountered post-merge**: none; implementation is not merged into production runtime yet.
- **OpenSpec validate state at archive**: `openspec validate redesign-agent-runtime --json` passed before this retrospective.
- **Test coverage signal**: `yarn workspace @yesimbot/agent-runtime test` reported 14 test files and 36 tests passing; `yarn turbo run check-types test build --filter=@yesimbot/agent-runtime` reported 3 successful tasks.

Commit chain:

```text
c59d1894 equivalent baseline from origin/dev
57211c81 feat(agent-runtime): add experimental runtime package
```

Verification evidence:

```text
yarn exec oxlint packages/agent-runtime
Found 0 warnings and 0 errors.

yarn workspace @yesimbot/agent-runtime test
Test Files 14 passed (14)
Tests 36 passed (36)

yarn turbo run check-types test build --filter=@yesimbot/agent-runtime
Tasks: 3 successful, 3 total

openspec validate redesign-agent-runtime --json
valid: true
```

---

## 1. Wins

- The change produced a separate experimental `@yesimbot/agent-runtime` package instead of widening `packages/agent`, matching D1 and keeping current core migration out of scope.
- The implementation kept `ai-sdk` as the provider boundary and avoided introducing an additional runner abstraction, matching D2 and the package dependency evidence in `packages/agent-runtime/package.json`.
- The public runtime API stayed focused around `append`, `send`, `run`, and `waitTurn`; tests cover append, turn, busy behavior, model conversion, tools, and package boundaries.
- Plugin behavior is expressed through a stable plugin shell plus typed hook map; compact and audit plugins exercise the extension points without making compact a core runtime feature.
- The final verification artifact captured the important archive caveats: `origin/dev` is an equivalent baseline, main specs still needed sync, and the full worktree had unrelated uncommitted files.

## 2. Misses

- 🟡 **painful**: The verify schema's commit PRECHECK assumes `origin/main` or `origin/master`, but this repository only had `origin/dev` for the useful equivalent baseline. This forced manual evidence handling in `verify.md`.
- 🟡 **painful**: The first final review found lifecycle and hook-policy issues after tasks were already checked complete. The repair cycle fixed them, but it shows task completion was ahead of semantic verification.
- 🟡 **painful**: `verify.md` initially understated its own untracked state, and final review had to correct the implementation-signal wording.
- 📌 **nit**: `pkgroll` warns about `package.json#exports["./package.json"]` pointing outside `dist`. The warning is consistent with existing package patterns and did not fail build, but it remains visible noise.
- 📌 **nit**: Active hours and total historical subagent count were not recorded in a durable machine-readable artifact, so the retrospective cannot reconstruct them precisely.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Scaffold and implementation steps | Implementation was committed as one path-limited feature commit instead of one commit per micro-step. | The repo already had a large active branch context, and the final evidence is path-limited to `57211c81`. |
| Verification baseline | Verification used `origin/dev` instead of the schema's `origin/main` / `origin/master` PRECHECK baseline. | The required refs were absent; the user explicitly approved `origin/dev` as the equivalent baseline. |
| Final archive flow | Specs are synced before archive in this local session. | `openspec-sync-specs` needs active delta specs; archiving first would move the change under `archive/` and make sync less direct. |
| Worktree isolation | No git worktree was used. | The user explicitly instructed development directly in the main repository checkout. |

## 4. Skill / workflow compliance

| Skill                                            | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming                        | ✓ |
| superpowers:writing-plans                        | ✓ |
| superpowers:using-git-worktrees                  | ✗ |
| superpowers:subagent-driven-development          | ✓ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review  | ✓ |
| superpowers:finishing-a-development-branch       | ✗ |
| openspec-apply-change                            | ✓ |
| verification-before-completion                   | ✓ |
| receiving-code-review                            | ✓ |
| openspec-sync-specs                              | ✓ |
| openspec-archive-change                          | ✓ |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: Creating or switching to a git worktree for the implementation and archive flow.
  - **Why this cycle**: The user explicitly instructed: "不使用worktree，直接在主仓库开发."
  - **How to prevent recurrence**: `scope-judgment rule` — when the user explicitly forbids worktrees for a named OpenSpec change, record the exception in retrospective and continue in the main checkout without prompting again.

- **`superpowers:finishing-a-development-branch`**
  - **What was skipped**: The branch-finishing decision tree for PR/merge/cleanup.
  - **Why this cycle**: The user requested immediate `openspec-archive-change` plus `openspec-sync-specs` finalization rather than branch integration guidance.
  - **How to prevent recurrence**: `schema graph fix` — archive-oriented schemas should model branch finishing as optional when the user explicitly requests local OpenSpec archive and spec sync in the same command.

## 5. Surprises

- The repository did not have `origin/main` or `origin/master`, so the verify schema's default commit PRECHECK returned the wrong signal for this branch.
- The useful equivalent baseline `origin/dev` was older than the branch and included 91 total commits, while the path-limited change evidence was exactly 1 commit.
- `plan.md` still contained many unchecked micro-step rows, but `tasks.md` was the authoritative task artifact for verify and had 25/25 complete.
- Review feedback after task completion exposed several real runtime edge cases: lazy init ordering, fail-open hook handling, early `run()` stream events, joined-message persistence, and runtime metadata leakage across the model boundary.

## 6. Promote candidates -> long-term learning

- [ ] 🟡 **Verify baseline should match repo branch topology** -> **Promote to schema**
  > **Why**: The verify PRECHECK's `origin/main|origin/master` assumption produced a false blocker in a repo whose useful remote baseline was `origin/dev`.
  > **How to apply**: When a schema asks for commit evidence, prefer the branch's configured upstream or allow an explicit equivalent baseline field instead of hard-coding main/master.

- [ ] 🟡 **Task checkboxes need semantic review before final verify** -> **Promote to skill**
  > **Why**: Tasks were checked complete before review found runtime lifecycle and hook-policy defects.
  > **How to apply**: Before marking complex runtime tasks done, require a focused semantic review for concurrency, hook error policy, persistence ordering, and provider-boundary leakage.

- [ ] 📌 **Retrospective evidence needs durable run metadata** -> **Promote to schema**
  > **Why**: Active hours and total subagent count could not be reconstructed from Git and had to be marked as not measured.
  > **How to apply**: For long OpenSpec changes, write a small machine-readable progress ledger with dispatch count, verification commands, and timing checkpoints.

- [ ] 📌 **Archive after sync when main specs do not exist yet** -> **Promote to CLAUDE.md**
  > **Why**: Syncing main specs from delta specs is simpler while the change is still active; archiving first moves the source under `archive/`.
  > **How to apply**: When a user asks for both sync and archive, run spec sync before moving the change directory unless the archive tool itself performs sync.
