# Retrospective: add-tool-call-observer

> Written: 2026-07-07 (after verify passed with non-blocking warnings)
> Commit range: uncommitted working-tree implementation
> Worktree: `/home/workspace/Athena`

---

## 0. Evidence

- **Commit range**: uncommitted working-tree implementation; no commit was created because the user did not request one.
- **Diff size**: tracked runtime diff is +152 / -3 lines across 4 files; new plugin and OpenSpec files are untracked until staged.
- **Tasks done**: 21/21 (`grep -cE '^\s*- \[x\]' tasks.md` -> 21)
- **Active hours**: approximately 2 active implementation/review hours, excluding the user pause between sessions.
- **Subagent dispatches**: 4 code-reviewer dispatches.
- **New external dependencies**: none.
- **Bugs encountered post-merge**: none; change is not merged.
- **OpenSpec validate state at verify**: pass (`openspec validate --all --json`: 11 items, 11 passed, 0 failed).
- **Test coverage signal**: `@yesimbot/agent-runtime` tools test 12 passed; tool-observer package tests 20 passed; affected type check/build passed; target oxlint 0 warnings/errors; target oxfmt all formatted.

Commit chain:

```text
No change commit was created in this cycle.
```

---

## 1. Wins

- Runtime failure observability was kept narrow: `packages/agent-runtime/src/agent.ts` now reports failed tool executions through `afterToolCall` with `isError: true`, and `packages/agent-runtime/tests/tools.test.ts` covers both observation and fail-open behavior.
- The optional plugin stayed outside core: `plugins/tool-observer/src/index.ts` registers through `ctx.yesimbot.registerAgentPlugin()` and uses `unsafeBot.sendMessage()` only from channel context.
- Display and model-visible compression stayed separate: package tests cover default non-rewriting behavior and opt-in JSON-like TOON replacement.
- Review gates caught real defects before completion: code-reviewer dispatches found the `beforeToolCall` allow-over-replace problem and two redaction bypasses, all fixed with regression tests.

## 2. Misses

- 🟡 [painful | evidence: `plugins/tool-observer/src/format.ts`, `plugins/tool-observer/tests/format.test.ts`] Initial redaction only handled strict JSON-like plain structures, so fallback preview paths could leak sensitive keys through `undefined`, class instances, or `toJSON` hooks.
- 🟡 [painful | evidence: `packages/agent-runtime/src/plugin.ts`, `packages/agent-runtime/tests/tools.test.ts`] Initial testing fixed `runBeforeToolHooks()` but did not immediately cover the actual plugin host path, where later `allow` could still override earlier `replace`.
- 📌 [nit | evidence: `verify.md`] `verify.md` is `PASS WITH WARNINGS` because this cycle remained uncommitted by rule and unrelated dirty files already existed in the checkout.

## 3. Plan deviations

| Plan task | What changed | Why |
|-----------|--------------|-----|
| Runtime failed hook observability | Also fixed `runBeforeToolHooks()` and `pluginHost.helpers.beforeToolCall()` replacement preservation. | Review exposed that observer safety depends on plugin pipeline semantics not overwriting earlier replace decisions. |
| Formatting and sanitization | Added conservative summaries for non-plain objects and dropped function-valued properties before fallback serialization. | Review found key-based redaction could be bypassed by class enumerable fields and `toJSON`. |
| Verification | Added `verify.md` and `retrospective.md`, but did not archive or commit. | Repository rules prohibit committing/archiving into a final branch state without explicit user instruction, and unrelated dirty files are present. |

## 4. Skill / workflow compliance

| Skill | Used |
|--------------------------------------------------|------|
| superpowers:brainstorming | ✓ |
| superpowers:writing-plans | ✓ |
| superpowers:using-git-worktrees | ✗ |
| superpowers:subagent-driven-development | ✗ |
| (transitive) superpowers:test-driven-development | ✓ |
| (transitive) superpowers:requesting-code-review | ✓ |
| superpowers:finishing-a-development-branch | ✗ |

### Deliberately Skipped Skills

- **`superpowers:using-git-worktrees`**
  - **What was skipped**: creating an isolated git worktree.
  - **Why this cycle**: the OpenSpec artifacts and an existing test change were already uncommitted in `/home/workspace/Athena`, and the repo rule says not to commit unless explicitly requested. Moving to a fresh worktree would have required copying uncommitted artifacts or creating commits without permission.
  - **How to prevent recurrence**: scope-judgment rule — when a superpowers-bridge apply starts from uncommitted OpenSpec artifacts, ask for explicit commit/worktree permission before implementation if the schema requires worktree isolation.

- **`superpowers:subagent-driven-development`**
  - **What was skipped**: fresh implementer subagent per task and per-task commit/review loop.
  - **Why this cycle**: the plan's microtasks were tightly coupled across the runtime hook, shared tests, plugin package, formatter, and verification artifacts, while the project rule prohibited the commit checkpoints expected by the SDD workflow.
  - **How to prevent recurrence**: schema graph fix — the superpowers-bridge apply instruction should include a no-commit fallback path for repositories where commit is explicitly disallowed unless requested.

- **`superpowers:finishing-a-development-branch`**
  - **What was skipped**: branch finishing, PR, archive, or merge workflow.
  - **Why this cycle**: verify recorded `PASS WITH WARNINGS`, the worktree remains dirty, and the user did not ask to commit, archive, or open a PR.
  - **How to prevent recurrence**: scope-judgment rule — only invoke branch finishing after explicit user instruction to commit/archive/PR when the repo has a no-commit-without-permission rule.

## 5. Surprises

- The plugin observer returning `{ type: "allow" }` looked harmless but could override prior `replace` decisions through hook pipeline semantics.
- The exported `runBeforeToolHooks()` helper and actual `pluginHost.helpers.beforeToolCall()` had diverging replacement preservation behavior, so both needed coverage.
- JSON fallback rendering can execute user-provided serialization hooks (`toJSON`) even after cloning unless function-valued properties are removed.
- Direct workspace tests can see stale dependency `dist` when importing runtime helpers from another package without rebuilding first; plugin tests were adjusted to avoid that unnecessary dependency.

## 6. Promote candidates -> long-term learning

- [ ] 🟡 **Observer hooks should return `undefined` unless they intentionally change pipeline state** -> **Promote to memory**
  > **Why**: Returning `allow` from a passive observer caused replacement decisions from earlier plugins to be lost.
  > **How to apply**: When implementing AgentPlugin observer hooks, return no decision/patch unless the feature explicitly owns a behavior change.

- [ ] 🔴 **Redaction must happen before every serialization path, including fallback paths and custom serialization hooks** -> **Promote to memory**
  > **Why**: Sensitive values could bypass redaction through non-strict JSON objects, class instances, and `toJSON`.
  > **How to apply**: When formatting unknown tool payloads, sanitize first and avoid executing user-provided object serialization hooks.

- [ ] 🟡 **Test actual runtime pipelines, not only exported helper utilities** -> **Promote to memory**
  > **Why**: The helper fix passed while the actual plugin host still had the allow-over-replace bug.
  > **How to apply**: For runtime hook semantics, include at least one test through `createAgent()` or the real plugin host path.

- [ ] 📌 **Superpowers-bridge needs an explicit no-commit fallback rule** -> **Promote to schema**
  > **Why**: The schema expects worktrees, commits, and branch finishing, but this repo forbids commits without explicit user instruction.
  > **How to apply**: When schema apply instructions conflict with repository no-commit policy, ask for commit/worktree permission or run a documented manual fallback.
