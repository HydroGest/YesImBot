# Verification Report

**Change**: `add-structured-system-prompts`
**Verified at**: `2026-07-08 14:20 +08:00`
**Verifier**: `Codex inline`

---

## 1. Structural Validation (`openspec validate --all --json`)

- [x] All items returned `"valid": true`

**Result**:

```text
rtk openspec validate --all --json
summary: 12 items checked, 12 passed, 0 failed
by type: 1 change passed, 11 specs passed
```

| Item | Type | Issues |
|---|---|---|
| — | — | — |

---

## 2. Task Completion (`tasks.md`)

- [x] All `- [ ]` tasks have been changed to `- [x]`

**Counts**:

```text
rtk grep -c '^- \[x\]' openspec/changes/add-structured-system-prompts/tasks.md -> 15
rtk grep -c '^- \[ \]' openspec/changes/add-structured-system-prompts/tasks.md -> 0
```

| Task | Incomplete reason | Blocks archive |
|---|---|---|
| — | — | — |

---

## 3. Delta Spec Sync State

Compared each delta spec under `openspec/changes/add-structured-system-prompts/specs/`
against `openspec/specs/<capability>/spec.md`.

| Capability | Sync state | Notes |
|---|---|---|
| `agent-plugin-system` | ✗ Needs sync | Delta spec differs from main spec. |
| `agent-runtime-core` | ✗ Needs sync | Delta spec differs from main spec. |
| `core-runtime-integration` | ✗ Needs sync | Delta spec differs from main spec. |
| `memos-cloud-memory` | ✗ Needs sync | Delta spec differs from main spec. |
| `workspace-sandbox-tools` | ✗ Needs sync | Delta spec differs from main spec. |

---

## 4. Design / Specs Coherence Spot Check

| Sample | Design decision | Specs correspondence | Gap |
|---|---|---|---|
| Append-only structured hook | D1 adds a new hook that appends prompt parts without receiving the whole prompt. | `agent-plugin-system` requires `appendSystemPrompt` and forbids delete/replace/reorder APIs. | None. |
| Legacy-first ordering | D2 keeps `extendSystemPrompt` before structured append hooks. | `agent-plugin-system` requires legacy hooks before structured append hooks and deterministic plugin order. | None. |
| Legacy string compatibility | D3 preserves `system: string` when no structured blocks exist. | `agent-runtime-core` requires legacy string prompt compatibility. | None. |
| String normalization | D4 normalizes string returns to system messages and preserves provider options on model messages. | `agent-plugin-system` covers string blocks, system model messages, and arrays. | None. |
| Fail-open behavior | D5 emits plugin diagnostics and continues when structured hooks throw. | `agent-plugin-system` modifies Plugin Error Policy to include structured prompt append hooks. | None. |
| Official plugin migration | D6 migrates core prompt files, workspace, MemOS, skill, and search-service. | `core-runtime-integration`, `workspace-sandbox-tools`, and `memos-cloud-memory` require structured system input for migrated prompt guidance. | None. |

**Drift warnings**:

- None.

---

## 5. Implementation Signal

- [x] Implementation code changes are committed.
- [ ] Worktree has no unstaged files.
- [ ] All related commits have been pushed.

**Commit range**: `47ec0626..0ccc1bb6`

```text
0ccc1bb6 feat(agent-runtime): add structured system prompt hooks
```

Notes:

- The schema precheck command that uses `origin/main` or `origin/master` cannot
  be used literally in this repository because branch `redev` has no upstream
  and neither `origin/main` nor `origin/master` exists locally.
- The actual implementation evidence is the local commit range
  `47ec0626..0ccc1bb6`.
- `rtk git status --short` still reports pre-existing unrelated deletions:
  `core/src/extension/context.ts` and `core/src/extension/manager.ts`.
  The handoff explicitly identified those deletions as pre-existing and this
  verification did not restore or stage them.
- `.superpowers/sdd/progress.md` changed after the implementation commit as
  process bookkeeping for verify/retrospective/archive.
- Push state was not checked because no upstream is configured for `redev`.

---

## 6. Front-Door Routing Leak Detector (warning, non-blocking)

Detection:

```bash
ls docs/superpowers/specs/*.md 2>/dev/null
```

- [x] No files were found by the detector.

| File | Captured in change | Suggested action |
|---|---|---|
| — | — | — |

---

## 7. Deferred Manual Dogfood vs Automated Test Equivalence

`plan.md` and `tasks.md` contain no `[~]` deferred manual dogfood rows.

| Deferred dogfood (plan §) | Equivalent automated test | Coverage assessment | Real gap? |
|---|---|---|---|
| — | — | — | — |

---

## Overall Decision

- [ ] ✅ PASS — ready for finishing-a-development-branch and archive
- [x] ⚠️ PASS WITH WARNINGS — ready for retrospective and archive after syncing delta specs; warnings are limited to pending spec sync, no upstream for push evidence, and pre-existing unrelated worktree deletions.
- [ ] ❌ FAIL — return to failed artifact and rerun verify

**Next step**:

Write `retrospective.md`, sync the delta specs into `openspec/specs/`, then archive this change.
