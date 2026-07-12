## Context

Athena's agent runtime already has pieces that apeira composes more cleanly: channel, state, storage, plugins, and a turn queue. Today those pieces are only partially separated. `createTurnQueue` schedules work, but `createAgent` still owns abort controllers, turn terminal handling, AI SDK multi-step execution, event fanout for `run()`, and `waitTurn(turnId)` retained results.

Core depends on that wait/result shape:

```ts
turnId = runtime.send(message)
result = await runtime.waitTurn(turnId)
extractAssistantTexts(result.messages)
```

Reference apeira code composes `Agent` from `AgentChannel` + `AgentQueue`, with `wait()` as idle barrier and model execution injected as `Runner`. Athena should take the composition lesson, not the Runner or always-join semantics.

Constraints from exploration:

- No Runner abstraction; AI SDK only.
- Prefer not to add new source files.
- No `observe()` API.
- Keep `append` and `ifBusy`.
- Keep nested `agent.channel`.

## Goals / Non-Goals

**Goals:**

- Make turn control (queue, busy policy, abort, idle wait) live primarily in `turn.ts`.
- Keep AI SDK execution local to `agent.ts` without a Runner type/module.
- Replace public `waitTurn(turnId)` with apeira-like idle `wait({ signal? })`.
- Make `run(message)` the primary process path for collecting turn-scoped internal events.
- Expand `run()` to yield all internal events for the created turn id (plan A).
- Migrate core routing to consume the run stream and render assistant texts from `message.appended`.
- Keep implementation scoped to existing modules plus call-site/test updates.

**Non-Goals:**

- Do not introduce `Runner`, `observe()`, or new package-level execution modules.
- Do not change message storage format or JSONL layout.
- Do not replace `ifBusy` with always-join.
- Do not merge channel methods onto the top-level `Agent` type.
- Do not make `wait()` return `TurnResult`.
- Do not redesign plugin hooks beyond what the new wait/run path requires.
- Do not pursue broad refactors unrelated to turn composition.

## Decisions

### D1: Queue/turn engine vs model execution boundary

- **Choice**: `turn.ts` owns scheduling, busy behavior, join protocol, abort ownership, idle wait, active turn id, and interrupt. `agent.ts` keeps `executeTurn` as a local closure that calls AI SDK `streamText` directly and is passed as `onRun`.
- **Reason**: Separates "when/how turns are queued" from "what the model does inside a turn" without inventing a second executor abstraction.
- **Rejected**: Extracting `runner.ts` / public `Runner` type — YAGNI and contradicts the no-new-file preference.

### D2: Wait API becomes idle barrier

- **Choice**: Public API is `wait(options?: { signal?: AbortSignal }): Promise<void>`.
  - Resolves when no active turn, no pending queued turns, and pump is idle.
  - Failure/abort of turns does not reject `wait`.
  - Aborting the wait signal cancels only the waiter.
- **Reason**: Matches apeira barrier semantics and removes retained-result maps from the public contract.
- **Rejected**: Keeping `waitTurn(turnId)` alongside idle wait — two waiting models. Making wait return `TurnResult` — reintroduces waitTurn under another name.

### D3: Process path is `run()`, written as stream + consume

- **Choice**: Core and similar callers use:

```ts
const stream = runtime.run(createPlatformMessage(session));

try {
  for await (const event of stream) {
    // ...
  }
} catch {
  // ...
}
```

No `observe(turnId)` helper.

- **Reason**: One API starts the turn and exposes its events. A local variable separates "trigger" from "consume" enough for readability without new surface area.
- **Rejected**: `send + wait + storage scrape` as reply source — race-prone with join/append. New `observe()` API — unnecessary indirection.

### D4: `run()` event membership is plan A

- **Choice**: The async iterable from `run(turnId)` yields every internal event associated with that turn id, including:
  - `turn.queued` / `turn.start` / `turn.step` / `turn.delta` / `turn.done` / `turn.failed` / `turn.aborted`
  - `message.appended` when scoped with the turn id
  - `tool.start` / `tool.done` / `tool.failed` / `tool.blocked`
- **Reason**: Core needs assistant messages from the stream; tool events keep the turn view complete for tests and future observers.
- **Rejected**: Turn-only stream — forces secondary lookup for replies. Message-only stream — loses terminal/failure structure.

### D5: Composition style for Agent

- **Choice**: Compose implementations, expose a flat Agent facade:
  - nested `channel`, `storage`, `state`
  - bound turn methods from queue
  - lifecycle/message methods from agent wiring
  - no Channel interface inheritance on Agent
- **Reason**: Keeps call sites simple while making ownership explicit in code structure.
- **Rejected**: `Agent extends AgentChannel & AgentQueue` — muddies event bus with business API.

### D6: Core reply and failure handling

- **Choice**:
  - Collect assistant messages from turn-scoped `message.appended` events during `for await`.
  - Treat `turn.failed` as processing failure for direct/mention turns.
  - Use existing `extractAssistantTexts` on collected assistant messages.
  - Keep generic error reply behavior for non-append failures.
- **Reason**: Preserves user-visible reply behavior while changing only the completion transport.
- **Rejected**: Reading all storage messages after idle wait — mixes observation/join history into reply selection.

### D7: File and abstraction budget

- **Choice**: Prefer modifying `agent.ts` and `turn.ts` only for runtime structure; update core/service and tests as needed. No new runtime source modules unless an unavoidable compile/test boundary appears.
- **Reason**: User constraint and KISS.
- **Rejected**: Splitting message IO / runner / observe helpers into new files in this change.

### D8: `TurnResult` retention

- **Choice**: Keep `TurnResult` as the structure used by turn completion hooks (`onTurnFinish`) and internal settle paths if useful. Do not expose retained turn results through public wait.
- **Reason**: Plugins still benefit from a structured completion object; public callers should use events.
- **Rejected**: Deleting `TurnResult` entirely in the same change — unnecessary coupling of plugin API cleanup to wait migration.

## Risks / Trade-offs

- [Risk] Expanding `run()` event membership may surprise callers that assumed turn-only streams → Mitigation: document in specs; update runtime tests that assert event types; keep stream still turn-scoped by id.
- [Risk] Idle `wait()` cannot express "my specific turn finished while others remain queued" → Mitigation: process path uses `run()` stream termination, not `wait()`.
- [Risk] Core busy tracking via `activeTurns` may drift from `runtime.isIdle()` → Mitigation: prefer runtime idle/active signals where straightforward; keep behavior equivalent for join routing.
- [Risk] Large `agent.ts` remains large because execution stays there → Mitigation: accept for this change; composition and queue ownership are the structural win, not line-count vanity.
- [Trade-off] Breaking `waitTurn` instead of deprecating → Accepted to avoid dual APIs in an experimental runtime package.
- [Trade-off] No Runner abstraction even though apeira has one → Accepted; only one executor exists.

## Migration Plan

1. Update runtime specs/contracts for wait/run/composition.
2. Change `turn.ts` wait model and abort ownership.
3. Adjust `agent.ts` public surface, run stream filtering, and composition wiring.
4. Migrate runtime tests from `waitTurn` to `run` stream assertions and/or idle `wait`.
5. Migrate `core/src/service.ts` direct/mention path to stream consumption.
6. Update core tests/mocks.
7. Run package-scoped typecheck/tests for `@yesimbot/agent-runtime` and `koishi-plugin-yesimbot`.

Rollback: revert the change set; no storage migration is involved.

## Open Questions

- Should interrupt return the aborted turn id (apeira-like) or remain `Promise<void>`? Default for this change: keep current void-ish interrupt unless a caller need appears during implementation.
- Can core delete `activeTurns` entirely in the same change, or only stop using `waitTurn` first? Default: stop depending on turn results first; simplify busy tracking if it stays local and low-risk.
- After removing `waitTurn`, should `TurnNotFoundError` remain exported? Default: remove wait-path usage; delete export only if unused.
