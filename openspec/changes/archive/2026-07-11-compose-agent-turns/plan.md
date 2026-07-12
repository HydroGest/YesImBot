# Compose Agent Turns Implementation Plan

> **For agentic workers:** Prefer executing this as a focused runtime/core change with package-scoped verification. Keep edits inside existing files unless compilation absolutely requires otherwise.

**Goal:** Compose agent turn control around the queue, replace `waitTurn` with idle `wait`, make `run()` the process path with full turn-scoped events, and migrate core replies to stream consumption — without introducing a Runner or new observe API.

**Architecture:** Thicken `turn.ts` into the turn control engine; keep AI SDK execution local in `agent.ts`; assemble a compositional Agent facade; core consumes `const stream = runtime.run(message)` then `for await`.

**Tech Stack:** TypeScript, AI SDK, Vitest, Yarn 4 workspaces, existing `@yesimbot/agent-runtime` and `koishi-plugin-yesimbot`.

## Global Constraints

- Use `yarn` through `rtk`.
- No Runner abstraction / no new runtime execution module.
- No `observe()` API.
- Prefer only `agent.ts`, `turn.ts`, `core/src/service.ts`, and tests.
- Keep `append` + `ifBusy`.
- Keep nested `agent.channel`.
- Do not commit unless the user explicitly asks.

## File Structure

- Modify: `packages/agent-runtime/src/turn.ts`
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/index.ts` only if exports need cleanup
- Modify: `packages/agent-runtime/src/errors.ts` only if wait-path errors become unused
- Modify: `packages/agent-runtime/tests/*.ts` that use `waitTurn` / run stream assumptions
- Modify: `core/src/service.ts`
- Modify: `core/tests/*.ts` mocks using `waitTurn`

## Task Order

### Task 1: Queue wait/abort boundary

**Files:** `turn.ts`, related runtime tests later

1. Change queue public wait API to idle barrier with optional signal.
2. Ensure `isIdle` accounts for active turn, queued turns, and pumping.
3. Own abort controller on active turn if it can be moved cleanly from agent closure.
4. Preserve enqueue busy behaviors and join drain helpers.

### Task 2: Agent public surface + run stream

**Files:** `agent.ts`

1. Replace `waitTurn` with bound `wait`.
2. Broaden turn stream membership to all internal events with matching `turnId` (and turn-scoped message events).
3. Keep `executeTurn` local; pass it as `onRun`.
4. Compose returned Agent object from parts; do not invent Runner.

### Task 3: Runtime tests

**Files:** `packages/agent-runtime/tests/*`

Migration patterns:

```ts
// old
const turnId = agent.send(msg);
await expect(agent.waitTurn(turnId)).resolves.toMatchObject({ status: "done" });

// new process assertion
const events = [];
for await (const event of agent.run(msg)) events.push(event);
expect(events.some((e) => e.type === "turn.done")).toBe(true);

// idle barrier
agent.send(msg);
await agent.wait();
expect(agent.isIdle()).toBe(true);
```

Cover:

- run includes `message.appended` / tool events for the turn
- failed terminal event path
- interrupt -> `turn.aborted`
- wait signal abort does not kill turn
- busy join/defer/reject unchanged

### Task 4: Core service migration

**Files:** `core/src/service.ts`, `core/tests/*`

```ts
const stream = runtime.run(createPlatformMessage(session));
const assistant = [];
for await (const event of stream) {
  if (event.type === "message.appended" && event.message.role === "assistant") {
    assistant.push(event.message);
  }
  if (event.type === "turn.failed") {
    throw new Error(event.error.message);
  }
}
for (const text of extractAssistantTexts(assistant)) {
  await session.send?.(text);
}
```

Keep append/join routes. Update mocks accordingly.

### Task 5: Verify

```bash
rtk yarn turbo run check-types --filter=@yesimbot/agent-runtime
rtk yarn turbo run test --filter=@yesimbot/agent-runtime
rtk yarn turbo run check-types --filter=koishi-plugin-yesimbot
rtk yarn turbo run test --filter=koishi-plugin-yesimbot
```

## Done When

- No public `waitTurn` in agent-runtime.
- `wait()` is idle barrier.
- `run()` yields full turn-scoped internal events.
- Core direct/mention path uses run stream consumption.
- Package-scoped checks above pass.
