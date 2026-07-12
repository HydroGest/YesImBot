## Why

`createAgent` currently owns too much: turn scheduling, abort ownership, AI SDK execution, event streaming, and a wait API centered on retained `TurnResult`s. That makes the runtime harder to reason about than the message-first design intends, and it diverges from the clearer queue composition in apeira while still needing Athena-specific routing (`append`, `ifBusy`). Cleaning the turn boundary now unblocks a smaller agent surface and a more event-driven core reply path.

## What Changes

**Turn queue owns turn control**
- From: `turn.ts` only schedules requests; abort, idle meaning, and most turn lifecycle concerns live in the `createAgent` closure.
- To: `turn.ts` owns scheduling, `ifBusy`, join drain protocol, abort ownership, and idle barrier wait.
- Reason: Queue/turn control should be separable from model execution details.
- Impact: Breaking only if callers depended on private structure; public method names mostly stay, wait semantics change.

**Replace `waitTurn` with idle `wait`**
- From: `waitTurn(turnId)` resolves retained `TurnResult` and rejects unknown ids.
- To: `wait({ signal? })` resolves when the agent is idle and returns `void`; failures do not reject wait.
- Reason: Align with apeira-style barrier wait and remove retained-result bookkeeping from the public path.
- Impact: Breaking API for runtime callers and tests.

**`run()` becomes the process path**
- From: Core uses `send` + `waitTurn` and renders from `TurnResult.messages`; `run()` yields only `turn.*` events.
- To: Core uses a local stream from `run(message)` and consumes turn-scoped internal events; `run()` yields all internal events for that turn id, including `message.appended` and `tool.*`.
- Reason: Replies and failures should come from the turn event stream without a second wait/result channel.
- Impact: Breaking for any consumer assuming `run()` is turn-event-only; core routing adapts.

**Compositional Agent assembly, no Runner**
- From: One large factory body implements nearly everything and exposes a flat mega-surface including `waitTurn`.
- To: `createAgent` composes channel, state, storage, plugin host, and turn queue; model execution remains a local AI SDK closure with no Runner abstraction or new execution module.
- Reason: Composition without inventing a second executor boundary.
- Impact: Non-breaking to config shape; public Agent methods change as above.

**Core reply collection**
- From: `extractAssistantTexts(result.messages)` after `waitTurn`.
- To: Collect assistant `message.appended` events from the `run()` stream, throw/log on `turn.failed`, then render texts.
- Reason: Matches event-first completion without retained results.
- Impact: Breaking to core service internals and mocks.

## Capabilities

### New Capabilities
- None. This change reshapes existing runtime/core capabilities rather than introducing a new domain capability.

### Modified Capabilities
- `agent-runtime-core`: Turn invocation API, wait semantics, run stream membership, agent composition, interrupt/idle behavior.
- `core-runtime-integration`: Message routing completion path and assistant reply source for direct/mention turns.

## Impact

- Primary code: `packages/agent-runtime/src/agent.ts`, `packages/agent-runtime/src/turn.ts`, `core/src/service.ts`.
- Tests/mocks across `packages/agent-runtime/tests/*` and `core/tests/*` that use `waitTurn`.
- Public runtime API: remove `waitTurn`; add/replace with idle `wait`; expand `run()` event scope.
- No new packages, no storage migration, no Runner module, no `observe()` API.
- Intentionally breaking for runtime consumers that waited on retained turn results.
