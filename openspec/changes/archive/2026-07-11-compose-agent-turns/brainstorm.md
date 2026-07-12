<!--
Raw capture of superpowers:brainstorming / opsx-explore output.
design.md reorganizes this content; do not treat this file as the structured design.
-->

# Brainstorm: Compose Agent Turns

## Project Context

Athena / YesImBot v4 centers on `@yesimbot/agent-runtime` and a thin Koishi core.

Relevant current shape:

- `packages/agent-runtime/src/agent.ts` is ~794 lines: wiring, turn execution, AI SDK `streamText`, tool wrapping, append pipeline, and public API assembly live in one factory closure.
- `packages/agent-runtime/src/turn.ts` is a scheduler only: `enqueue`, `ifBusy`, `join`, retained `waitTurn(turnId) -> TurnResult`.
- Core `handleSession` uses `send` + `waitTurn(turnId)` and renders replies from `TurnResult.messages`.
- Reference: `references/apeira/packages/core/src/utils/agent.ts` composes `Agent = Channel + Queue + lifecycle`. Queue owns turn lifecycle; model execution is injected as `Runner`. `wait()` is an idle barrier returning `void`.

Existing specs that constrain this change:

- `agent-runtime-core`: `send` / `run` / `waitTurn`, retained `TurnResult`, `ifBusy`, compositional `Agent` interface.
- `core-runtime-integration`: direct/mention routing waits for turn result before rendering assistant replies.

## Decision Chain

### Q1: What should Athena learn from apeira?

Decision: Learn boundary composition, not semantics wholesale.

- Queue owns turn scheduling, busy policy, abort ownership, and idle wait.
- Agent composes channel / state / storage / turns / local AI execution.
- Do **not** introduce a public or internal `Runner` abstraction.
- Do **not** switch to always-join; keep `ifBusy: defer | join | reject` and independent `append`.
- Do **not** lift `channel.emit/subscribe` onto the top-level `Agent` interface.

Reasoning: Athena already depends on message-first routing that apeira does not have. Copying always-join or Runner would create unused abstraction and break core routing.

### Q2: Should model execution become a Runner?

Decision: No. Keep AI SDK `streamText` as the direct executor inside `createAgent` / local `executeTurn` closure.

Reasoning: There is only one executor today. A Runner type/file would be YAGNI and contradicts "尽量不拆分新文件".

Implication: `turn.ts` receives an `onRun` callback, not a named Runner concept. Execution stays in `agent.ts`.

### Q3: What replaces `waitTurn`?

Decision: Replace with apeira-like `wait({ signal? }): Promise<void>` as an idle barrier.

- Resolves when the agent is idle.
- Does **not** reject because a turn failed.
- Does **not** return `TurnResult`.
- Optional `AbortSignal` cancels the wait, not the turn.

Reasoning: Per-turn retained results couple callers to turn bookkeeping. Idle wait is the simpler barrier for reset/dispose/tests.

Implication: `TurnResult` may remain for plugin `onTurnFinish`, but is no longer the public wait return value.

### Q4: How does core get replies and failures without `waitTurn`?

Decision: Core uses `run()` as the process path, written with a local stream variable for readability:

```ts
const stream = runtime.run(createPlatformMessage(session));

try {
  for await (const event of stream) {
    // collect assistant message.appended
    // throw on turn.failed
  }
  // render assistant texts
} catch ...
```

No new `observe()` API.

Reasoning: `run(message)` is still the single call that starts a turn and yields its events. Splitting into a local `stream` variable keeps trigger and consumption visually distinct without adding surface area. `send + wait` is intentionally not the result path.

### Q5: What events does `run()` yield?

Decision: Plan A — all internal events for that turn id.

Include:

- `turn.*`
- `message.appended` with matching `turnId`
- `tool.*` with matching `turnId`

Reasoning: Core needs assistant messages from the stream; plugins/tests benefit from tool events in the same turn-scoped view. Filtering only `turn.*` would force storage scraping for replies.

### Q6: How compositional should the public Agent type be?

Decision: Compositional implementation with a flat, narrow public face.

- Keep nested `agent.channel`.
- Bind turn methods from the queue object (`send`, `wait`, `interrupt`, `isIdle`, `getActiveTurnId`).
- Do not `Agent extends AgentChannel`.
- Prefer optional internal `AgentTurns`-like shape if useful, without forcing inheritance.

Reasoning: Nested channel is clearer than apeira's interface merge. Flat methods remain convenient for core and tests.

### Q7: How many files may change structure?

Decision: Prefer existing files only.

Primary:

- `packages/agent-runtime/src/agent.ts`
- `packages/agent-runtime/src/turn.ts`
- `core/src/service.ts`
- related tests / mocks

Avoid new `runner.ts`, `message-io.ts`, `observe.ts`.

Reasoning: User constraint "尽量不拆分新文件". Responsibility moves inside current modules.

### Q8: Is this a breaking API change?

Decision: Yes, intentionally.

- Remove public `waitTurn(turnId)`.
- Add/replace with `wait({ signal? })`.
- Expand `run()` stream membership.
- Core routing and all wait-based tests must migrate.

Reasoning: Keeping both APIs would leave two waiting models and defeat the cleanup.

## Agreed Approach

Compose agent turns around an apeira-inspired queue boundary while keeping Athena's message routing and AI SDK executor:

1. Thicken `turn.ts` into the turn engine for scheduling, busy policy, abort, and idle `wait`.
2. Keep `executeTurn` local to `agent.ts` with direct AI SDK usage.
3. Assemble `Agent` by composing existing pieces.
4. Make `run()` the primary process path, yielding all turn-scoped internal events.
5. Migrate core to:

```ts
const stream = runtime.run(message);
for await (const event of stream) { ... }
```

6. Delete `waitTurn` / retained public result map.

## Open Points Deferred To Design / Specs

- Exact `isIdle` definition after abort/clear.
- Whether core keeps `activeTurns` map or derives busy from `runtime.isIdle()`.
- Whether `TurnNotFoundError` remains after `waitTurn` removal.
- Whether interrupt returns aborted turn id (apeira-like) or stays void-ish.
