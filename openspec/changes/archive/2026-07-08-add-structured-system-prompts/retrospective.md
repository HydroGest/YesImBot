# Retrospective: add-structured-system-prompts

> Written: 2026-07-08 (after verify passed with warnings)
> Commit range: `47ec0626..0ccc1bb6`
> Worktree: `/home/workspace/Athena`

---

## 0. Evidence

- **Commit range**: `47ec0626..0ccc1bb6` (1 commit)
- **Diff size**: `+1970 / -49` lines across 30 files
- **Tasks done**: 15/15 (`grep -cE '^\s*- \[x\]' tasks.md` -> 15)
- **Active hours**: ~1.5 hours in the apply/verify session
- **Subagent dispatches**: 7 total; 5 implementation/verification workers, 1 final reviewer, 1 failed verify worker before the user requested inline execution
- **New external dependencies**: none
- **Bugs encountered post-merge**: none; not merged yet
- **OpenSpec validate state at archive**: pass before archive (`rtk openspec validate add-structured-system-prompts`)
- **Test coverage signal**: targeted Vitest suites passed for runtime (12 tests), core (8 tests), workspace (6 tests), MemOS client (4 tests), and skill (6 tests); targeted package type-checks passed for runtime, core, workspace, MemOS, skill, and search-service

Commit chain:

```text
0ccc1bb6 feat(agent-runtime): add structured system prompt hooks
```

---

## 1. Wins

- The implementation stayed narrow: runtime API, model-boundary system input, official prompt-extending plugins, tests, and OpenSpec artifacts only.
- The runtime now has an append-only structured prompt path while keeping `extendSystemPrompt(prompt: string, context)` source-compatible.
- Tests cover structured string blocks, `SystemModelMessage` blocks with provider options, array returns, `undefined`, fail-open diagnostics, AI SDK `system` mapping, legacy string compatibility, and structured-only system prompts.
- Official prompt-extending plugins now use `appendSystemPrompt`, avoiding message-history prompt injection and demonstrating the intended API.
- The final code review found no Critical or Important issues.

## 2. Misses

- 🟡 [painful | evidence: `openspec instructions verify`] The verify precheck assumes `origin/main` or `origin/master`, but this repo has neither. The cycle needed an explicit local range, `47ec0626..0ccc1bb6`, to establish commit evidence.
- 🟡 [painful | evidence: subagent `019f405f-3650-72e2-a3b1-fe82445ed3b2`] The verify worker failed with provider 503, so the verify/retro/archive tail had to proceed inline after the user requested no more subagents.
- 📌 [nit | evidence: final review] `packages/agent-runtime/README.md` still shows a legacy `extendSystemPrompt` example. It is non-blocking because the public API remains supported, but future docs should steer new plugin authors toward `appendSystemPrompt`.
- 📌 [nit | evidence: `git status --short`] Pre-existing unrelated deletions under `core/src/extension/*` kept the worktree from being clean during verify, even though the implementation commit excluded them.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Workspace setup | No worktree was created. | The user explicitly required "本次不使用worktree". |
| Per-task review cadence | The apply phase used controller quick-checks after each phase and one final reviewer instead of reviewer per task. | The user explicitly required no extra per-Phase reviewer and one final total review. |
| Verify execution | The first verify worker failed; verify was then completed inline. | Provider returned 503 and the user explicitly said "不要派发子代理，inline实现". |
| Verify implementation signal | Used `47ec0626..0ccc1bb6` instead of the schema's `origin/main`/`origin/master` precheck. | The repository has no upstream for `redev` and no local `origin/main` or `origin/master`. |

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

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: Creating an isolated git worktree for this change.
  - **Why this cycle**: The user explicitly set the cycle constraint "本次不使用worktree" before execution began.
  - **How to prevent recurrence**: `scope-judgment rule` — when the user explicitly overrides worktree creation, record the override in SDD progress and continue in the current checkout without treating it as a process failure.

- **`superpowers:finishing-a-development-branch`**
  - **What was skipped**: PR/branch finishing flow after archive.
  - **Why this cycle**: The user request for this continuation was specifically "verify, retrospective and archive"; branch finishing/PR creation was not requested, and `redev` has no upstream configured.
  - **How to prevent recurrence**: `scope-judgment rule` — run finishing-a-development-branch only when the user asks for PR/merge/branch finishing or when the schema-driven cycle explicitly includes that final delivery step in scope.

## 5. Surprises

- The schema's verify precheck was too opinionated for this repo's remote layout; it assumed main/master remotes that do not exist here.
- The provider failure arrived exactly at the verify phase, which made the user's "inline implementation" constraint the simplest and most reliable path.
- The pre-existing deleted empty extension files did not affect implementation, but they mattered for the verify worktree-cleanliness signal.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Verify prechecks should tolerate repos without `origin/main` or `origin/master`** → **Promote to schema**
  > **Why**: This cycle had a valid implementation commit, but the schema's literal precheck returned 0 because the expected remote branches did not exist.
  > **How to apply**: In superpowers-bridge verify instructions, fall back to the branch base commit or user-supplied implementation range when `origin/main` and `origin/master` are absent.

- [ ] 🟡 **Respect explicit no-subagent continuation immediately** → **Promote to memory**
  > **Why**: After a provider 503, the user explicitly requested inline execution, and continuing without subagents reduced risk and delay.
  > **How to apply**: When the user says "不要派发子代理" or equivalent, complete remaining workflow steps inline even if the earlier process plan used SDD.

- [ ] 📌 **README examples should follow newly preferred APIs after migration changes** → **Promote to project guide**
  > **Why**: The code migrated official plugins to `appendSystemPrompt`, but README still demonstrates legacy `extendSystemPrompt`.
  > **How to apply**: After API migration tasks, scan public examples for old-but-supported APIs and decide whether updating docs is in scope.
