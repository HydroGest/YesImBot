# Verify: compose-agent-turns

**Date**: 2026-07-11  
**Overall Decision**: PASS

## Summary

Implementation for `compose-agent-turns` matches the change proposal, design, and delta specs. Runtime wait/run composition and core stream-based reply collection are in place. Package-scoped type checks and tests passed. Main specs were synced before archive; the implementation remains uncommitted by user choice.

## Checks

### 1. Structural validation

- Command: `openspec validate --all --json --store plans`
- Result: **PASS**
- Summary: 12 items, 12 passed, 0 failed
- Notes: `agent-runtime-core` emitted one non-blocking INFO about a long requirement text in the main catalog.

### 2. Task completion

- Checked: `/home/workspace/plans/openspec/changes/compose-agent-turns/tasks.md`
- Result: **PASS**
- Checked boxes: `18`
- Unchecked boxes: `0`
- All tasks 1.1–5.3 are complete.

### 3. Delta spec sync state

- Result: **PASS — synced before archive**
- Capabilities:
  - `agent-runtime-core`
  - `core-runtime-integration`
- Evidence: `agent-runtime-core` and `core-runtime-integration` main specs now require idle `wait()` and `run()` stream observation rather than retained `waitTurn(turnId)` results.

### 4. Design / specs coherence

- Result: **PASS** with no blocking drift
- Spot-check:
  - D1 queue vs local AI execution ↔ no Runner requirement in delta specs
  - D2 idle `wait({ signal? })` ↔ Turn Invocation API / idle wait scenarios
  - D3 / D4 `run()` process path + full turn-scoped events ↔ Run Stream Membership + core Message Routing
  - D5 nested `agent.channel` ↔ compositional Agent interface / no channel method lifting
  - D6 core assistant collection from `message.appended` ↔ core Assistant Reply Rendering
  - D8 keep `TurnResult` for hooks only ↔ removed public Turn Result Semantics with migration note

### 5. Implementation signal

- Result: **WARNING**
- Code changes exist and are verified by tests, but **no change commit was created in this cycle** (repo rule: do not commit unless explicitly requested).
- Dirty implementation files observed:
  - `packages/agent-runtime/src/agent.ts`
  - `packages/agent-runtime/src/turn.ts`
  - `packages/agent-runtime/src/errors.ts`
  - `packages/agent-runtime/tests/*` wait/run migrations
  - `core/src/service.ts`
  - `core/tests/channel-context.test.ts`
  - `core/tests/error-handling.test.ts`
  - `core/tests/reset.test.ts`
- Commit range: none for this cycle.

### 6. Front-door routing leak detector

- Command: `ls docs/superpowers/specs/*.md`
- Result: **PASS**
- No `docs/superpowers/specs/` design-output leak detected.

### 7. Deferred dogfood vs automated-test equivalence

- Plan deferred markers (`[~]`): **none**
- Result: **N/A**
- No deferred manual/dogfood rows required equivalence mapping.

## Spec / design coverage against implementation

| Area | Expected | Observed | Status |
|------|----------|----------|--------|
| Public wait API | idle `wait({ signal? })` | `Agent.wait` + `createTurnQueue().wait` | PASS |
| Removed waitTurn | no public retained-result wait | no `waitTurn` references in runtime/core TS | PASS |
| Abort ownership | queue-centered interrupt | `turn.ts` owns controller + `interrupt()` | PASS |
| Run stream membership | all turn-scoped internal events | `isTurnScopedEvent` fans out any event with `turnId` | PASS |
| AI execution | direct AI SDK, no Runner | local `executeTurn` + `streamText` in `agent.ts` | PASS |
| Busy behavior | keep `ifBusy` | enqueue still supports defer/join/reject | PASS |
| Core process path | `const stream = runtime.run(...); for await` | `core/src/service.ts` | PASS |
| Core replies | assistant `message.appended` | collected then `extractAssistantTexts` | PASS |
| Core failure | `turn.failed` | throws and uses existing generic error reply | PASS |

## Test evidence

- `@yesimbot/agent-runtime`: **11 files / 74 tests passed**
- `koishi-plugin-yesimbot`: **11 files / 42 tests passed**
- `check-types` for both packages: **passed**

Commands used:

```bash
rtk yarn turbo run test --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot
rtk yarn turbo run check-types --filter=@yesimbot/agent-runtime --filter=koishi-plugin-yesimbot
```

## Warnings

1. **Uncommitted worktree** — implementation is complete and tested, but not committed by user rule.
2. **Schema apply path deviations** — no git worktree and no subagent-driven task loop were used; recorded in retrospective.

## Overall

**PASS**

The change is archived after syncing `agent-runtime-core` and `core-runtime-integration`. No blocking implementation gaps were found against the change artifacts.
