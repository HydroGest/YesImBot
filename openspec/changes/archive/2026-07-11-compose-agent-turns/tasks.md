## 1. Runtime Wait And Queue Boundary

- [x] 1.1 Replace public `waitTurn(turnId)` with idle `wait({ signal? })` in `packages/agent-runtime/src/turn.ts` and the `Agent` surface in `agent.ts`.
- [x] 1.2 Move active abort ownership into the turn queue where practical so `interrupt`, `isIdle`, and `getActiveTurnId` are queue-centered.
- [x] 1.3 Remove retained public wait-result bookkeeping and wait-path `TurnNotFoundError` usage if nothing else needs them.
- [x] 1.4 Keep `ifBusy: defer | join | reject` and join drain protocol behavior intact.

## 2. Run Stream And Agent Composition

- [x] 2.1 Expand `run()` so its async iterable yields all internal events for the created turn id (`turn.*`, turn-scoped `message.appended`, `tool.*`).
- [x] 2.2 Keep AI SDK `streamText` execution as a local `executeTurn`/equivalent closure in `agent.ts` with no Runner type or new execution file.
- [x] 2.3 Assemble the public `Agent` by composing channel, state, storage, plugin host, and turn queue bindings; keep nested `agent.channel`.
- [x] 2.4 Preserve `TurnResult` for plugin `onTurnFinish` unless a tiny local cleanup is required for compilation.

## 3. Runtime Test Migration

- [x] 3.1 Rewrite runtime tests that used `waitTurn` to assert through `run()` streams and/or idle `wait()`.
- [x] 3.2 Add/adjust coverage for idle wait signal abort, run stream membership (message/tool/turn events), and terminal failed/aborted observation without retained results.
- [x] 3.3 Keep busy-behavior, append-while-busy, interrupt, and plugin init failure coverage green under the new API.

## 4. Core Integration Migration

- [x] 4.1 Change `core/src/service.ts` direct/mention handling to:

```ts
const stream = runtime.run(createPlatformMessage(session));
for await (const event of stream) { /* collect assistant / handle failed */ }
```

- [x] 4.2 Render replies from collected assistant `message.appended` events via existing `extractAssistantTexts`.
- [x] 4.3 Keep append and join routing behavior equivalent for ordinary group messages and busy direct/mention messages.
- [x] 4.4 Update core tests/mocks that stub `waitTurn` to stub/consume `run` (and `wait` if needed).

## 5. Verification

- [x] 5.1 Run package-scoped typecheck/tests for `@yesimbot/agent-runtime`.
- [x] 5.2 Run package-scoped typecheck/tests for `koishi-plugin-yesimbot`.
- [x] 5.3 Fix any fallout in dependent plugin tests only if they break due to the public wait/run API change.
