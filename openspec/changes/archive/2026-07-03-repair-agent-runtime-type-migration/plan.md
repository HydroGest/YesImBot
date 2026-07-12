# Repair agent-runtime Type Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair `@yesimbot/agent-runtime` after the type migration and land the clarified no-message-metadata, named-channel, compositional-agent architecture.

**Architecture:** Keep message, entry, event, state, storage, plugin, turn, model, tool, and agent boundaries separate. `createAgent()` composes small primitives; messages stay semantic; entries own persistence envelope metadata; turn identity is carried by turn results, hook context, queue state, and turn-related internal events only.

**Tech Stack:** TypeScript, Yarn 4, `ai` 6, `@ai-sdk/provider-utils`, Vitest, OpenSpec `superpowers-bridge`.

## Global Constraints

- Use `yarn`, not `npm` or `pnpm`.
- Do not adapt `core` in this change.
- Do not add `meta`, runtime id, or `turnId` to `AgentMessage`.
- Do not use `AgentEntry.parentId` for turn membership.
- Use `crypto.randomUUID()` for runtime-generated identifiers.
- Use named `AgentChannel` channels: `internal` for runtime events and `stream` for stream parts.
- Only turn-related internal events carry `turnId`.
- Remove the public `AgentRuntime` type; export `Agent`.
- Use `apply_patch` for manual edits.
- Preserve unrelated user changes in the worktree.

---

## File Structure

- Modify: `packages/agent-runtime/src/types.ts` as a public barrel for domain type exports and shared hook/tool types.
- Modify: `packages/agent-runtime/src/types/message.ts` for clean semantic message unions.
- Modify: `packages/agent-runtime/src/types/entry.ts` for `AgentEntry`, `AgentEntryUnion`, and custom entry declarations.
- Modify: `packages/agent-runtime/src/types/event.ts` for internal event unions and named channel event declarations.
- Modify: `packages/agent-runtime/src/types/plugin.ts` for plugin runtime and hook imports.
- Modify: `packages/agent-runtime/src/types/state.ts` and `packages/agent-runtime/src/types/storage.ts` for domain contracts.
- Create/modify: `packages/agent-runtime/src/id.ts` for UUID id generation.
- Create/modify: `packages/agent-runtime/src/message.ts` for message constructors without `meta`.
- Create: `packages/agent-runtime/src/entry.ts` for entry constructors.
- Create: `packages/agent-runtime/src/event.ts` for internal event constructors and terminal event guards.
- Modify: `packages/agent-runtime/src/channel.ts` for named channel implementation.
- Modify: `packages/agent-runtime/src/storage.ts` for import paths and memory storage behavior.
- Modify: `packages/agent-runtime/src/state.ts` for state persistence via entry helpers.
- Modify: `packages/agent-runtime/src/plugin.ts` for named-channel plugin diagnostics and hook types.
- Modify: `packages/agent-runtime/src/turn.ts` for UUID turn ids and retained turn behavior.
- Modify: `packages/agent-runtime/src/model.ts` for clean message conversion.
- Modify: `packages/agent-runtime/src/tools.ts` for plugin type imports and turn context behavior.
- Modify: `packages/agent-runtime/src/agent.ts` as the composition root.
- Modify: `packages/agent-runtime/src/index.ts` for public exports.
- Modify tests under `packages/agent-runtime/tests/*.test.ts` to match the new contract.

---

### Task 1: Public Types And Helper Foundations

**Files:**
- Modify: `packages/agent-runtime/src/types.ts`
- Modify: `packages/agent-runtime/src/types/message.ts`
- Modify: `packages/agent-runtime/src/types/entry.ts`
- Modify: `packages/agent-runtime/src/types/event.ts`
- Modify: `packages/agent-runtime/src/types/plugin.ts`
- Create/modify: `packages/agent-runtime/src/id.ts`
- Create/modify: `packages/agent-runtime/src/message.ts`
- Create: `packages/agent-runtime/src/entry.ts`
- Create: `packages/agent-runtime/src/event.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/tests/message.test.ts`
- Test: `packages/agent-runtime/tests/storage.test.ts`
- Test: `packages/agent-runtime/tests/types.test.ts`

**Interfaces:**
- Produces: `createRuntimeId(): string`, `createEntry()`, `createMessageEntry()`, `createStateEntry()`, `createEventEntry()`, `createInternalEvent()`.
- Produces: clean message constructors `createUserMessage`, `createSystemMessage`, `createAssistantMessage`, `createToolMessage`, `createCustomMessage`.
- Produces: public `AgentMessage`, `AgentEntry`, `AgentState`, `AgentCustomMessage`, `AgentCustomEntry`, `AgentCustomEvent`.

- [ ] **Step 1: Update message constructor tests first**

Replace metadata assertions in `packages/agent-runtime/tests/message.test.ts` with expectations that messages are clean and entries own ids:

```ts
expect("meta" in message).toBe(false);
expect(entry.id).toMatch(UUID_REGEX);
expect(entry.type).toBe("message");
expect(entry.data).toBe(message);
```

Add the local test constant:

```ts
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
```

- [ ] **Step 2: Run the focused failing test**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/message.test.ts`

Expected: FAIL because `../src/message.js` is missing or old metadata helpers do not match.

- [ ] **Step 3: Restore UUID helper**

Create `packages/agent-runtime/src/id.ts`:

```ts
export function createRuntimeId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 4: Implement clean message helpers**

Create `packages/agent-runtime/src/message.ts` with constructors that do not create `meta`:

```ts
import type { JSONValue } from "ai";

import { createEntry } from "./entry.js";
import type {
  AgentAssistantMessage,
  AgentCustomMessageBase,
  AgentMessage,
  AgentSystemMessage,
  AgentToolMessage,
  AgentUserMessage,
} from "./types/message.js";

export function createUserMessage(content: AgentUserMessage["content"]): AgentUserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

export function createSystemMessage(content: AgentSystemMessage["content"]): AgentSystemMessage {
  return { role: "system", content, timestamp: Date.now() };
}

export function createAssistantMessage(
  content: AgentAssistantMessage["content"],
  options: Omit<Partial<AgentAssistantMessage>, "role" | "content" | "timestamp"> = {},
): AgentAssistantMessage {
  return { role: "assistant", content, timestamp: Date.now(), ...options };
}

export function createToolMessage(content: AgentToolMessage["content"]): AgentToolMessage {
  return { role: "tool", content, timestamp: Date.now() };
}

export function createCustomMessage<TType extends string, TContent = JSONValue>(
  type: TType,
  content: TContent,
): AgentCustomMessageBase<TType, TContent> {
  return { role: "custom", type, content, timestamp: Date.now() };
}

export function createMessageEntry(message: AgentMessage, options = {}) {
  return createEntry("message", message, options);
}

export { createEntry } from "./entry.js";
```

Adjust exact constructor signatures to match `types/message.ts` after Step 5.

- [ ] **Step 5: Align message types**

Update `packages/agent-runtime/src/types/message.ts` so the custom base exists and no built-in message requires `meta`:

```ts
export interface AgentCustomMessageBase<TType extends string = string, TContent = unknown> {
  role: "custom";
  type: TType;
  content: TContent;
  timestamp: number;
}

export interface AgentCustomMessage {
  custom: AgentCustomMessageBase;
}
```

Keep the built-in role interfaces with `timestamp: number` and without `meta`.

- [ ] **Step 6: Implement entry helpers**

Create `packages/agent-runtime/src/entry.ts`:

```ts
import { createRuntimeId } from "./id.js";
import type { AgentCustomEntry, AgentEntry } from "./types/entry.js";

export interface CreateEntryOptions {
  id?: string;
  timestamp?: number;
  parentId?: string;
}

export function createEntry<T extends keyof AgentCustomEntry>(
  type: T,
  data: AgentCustomEntry[T],
  options: CreateEntryOptions = {},
): AgentEntry<T> {
  return {
    id: options.id ?? createRuntimeId(),
    type,
    data,
    timestamp: options.timestamp ?? Date.now(),
    parentId: options.parentId,
  };
}
```

- [ ] **Step 7: Align entry types**

Update `packages/agent-runtime/src/types/entry.ts` so `message: AgentMessage` remains the entry payload and `parentId` has no turn semantics.

- [ ] **Step 8: Align event types and helper**

Update `packages/agent-runtime/src/types/event.ts` with event-specific `turnId` fields instead of `WithId<InternalEvent>` for all events. Create `packages/agent-runtime/src/event.ts`:

```ts
import type { AgentCustomEvent } from "./types/event.js";

export function createInternalEvent<T extends AgentCustomEvent["internal"]>(
  event: T,
): T & { id: string; timestamp: number } {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...event,
  };
}
```

If adding `id` and `timestamp` to every internal event makes type usage noisy, define a reusable `InternalEventEnvelope<T>` in `types/event.ts`.

- [ ] **Step 9: Fix public exports**

Update `packages/agent-runtime/src/types.ts` to re-export domain types and keep shared hook/tool types. Update `packages/agent-runtime/src/index.ts` to export `id.js`, `message.js`, `entry.js`, `event.js`, and type barrels.

- [ ] **Step 10: Verify Task 1**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/message.test.ts tests/storage.test.ts tests/types.test.ts
yarn turbo run check-types --filter=@yesimbot/agent-runtime
```

Expected: message/storage/types tests pass or fail only on modules not yet migrated; type check may still fail in agent/plugin/turn code and will be completed in later tasks.

**Commit point:** `git add packages/agent-runtime/src packages/agent-runtime/tests/message.test.ts packages/agent-runtime/tests/storage.test.ts packages/agent-runtime/tests/types.test.ts && git commit -m "refactor(agent-runtime): restore clean type helpers"` if committing is requested.

---

### Task 2: Named Channel And Plugin Diagnostics

**Files:**
- Modify: `packages/agent-runtime/src/channel.ts`
- Modify: `packages/agent-runtime/src/plugin.ts`
- Test: `packages/agent-runtime/tests/channel.test.ts`
- Test: `packages/agent-runtime/tests/plugin.test.ts`
- Test: `packages/agent-runtime/tests/audit-plugin.test.ts`

**Interfaces:**
- Consumes: `AgentCustomEvent["internal"]`, `AgentChannel`.
- Produces: named channel implementation with `emit(channel, event, options?)` and `subscribe(channel, listener)`.

- [ ] **Step 1: Rewrite channel tests for named channels**

In `tests/channel.test.ts`, subscribe to `"internal"` and emit a `turn.start` event:

```ts
const unsubscribe = channel.subscribe("internal", (event) => {
  if (event.type === "turn.start") seen.push(event.turnId);
});

await channel.emit("internal", { type: "turn.start", turnId: "turn-id" });
```

Assert non-turn events do not require `turnId`:

```ts
await channel.emit("internal", { type: "agent.init" });
```

- [ ] **Step 2: Run channel tests to verify failure**

Run: `yarn workspace @yesimbot/agent-runtime exec vitest run tests/channel.test.ts`

Expected: FAIL until channel implementation and event types match.

- [ ] **Step 3: Finalize channel implementation**

Ensure `packages/agent-runtime/src/channel.ts` exports:

```ts
export interface AgentChannel {
  emit: <K extends string>(
    channel: K,
    event: K extends keyof AgentCustomEvent ? AgentCustomEvent[K] : unknown,
    options?: { save?: boolean },
  ) => Awaitable<void>;
  subscribe: <K extends string>(
    channel: K,
    listener: K extends keyof AgentCustomEvent
      ? AgentEventListener<AgentCustomEvent[K]>
      : AgentEventListener,
  ) => () => void;
}
```

Keep listener errors isolated by catching them inside `emit`.

- [ ] **Step 4: Update plugin diagnostic tests**

Change tests that subscribe to `"plugin.error"` or `"plugin.disabled"` so they subscribe to `"internal"` and inspect `event.type`.

- [ ] **Step 5: Update plugin host diagnostics**

In `packages/agent-runtime/src/plugin.ts`, replace old event-name emission with:

```ts
void options.runtime.channel.emit("internal", {
  type: "plugin.error",
  plugin: pluginName,
  error,
});
```

For optional init failure, emit:

```ts
void options.runtime.channel.emit("internal", {
  type: "plugin.disabled",
  plugin: plugin.name,
  reason: error,
});
```

- [ ] **Step 6: Verify Task 2**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/channel.test.ts tests/plugin.test.ts tests/audit-plugin.test.ts
yarn turbo run check-types --filter=@yesimbot/agent-runtime
```

Expected: channel/plugin focused tests pass or fail only on agent runtime behavior not yet migrated.

**Commit point:** `git add packages/agent-runtime/src/channel.ts packages/agent-runtime/src/plugin.ts packages/agent-runtime/tests/channel.test.ts packages/agent-runtime/tests/plugin.test.ts packages/agent-runtime/tests/audit-plugin.test.ts && git commit -m "refactor(agent-runtime): use named runtime channels"` if committing is requested.

---

### Task 3: State, Storage, And Model Boundary

**Files:**
- Modify: `packages/agent-runtime/src/storage.ts`
- Modify: `packages/agent-runtime/src/state.ts`
- Modify: `packages/agent-runtime/src/model.ts`
- Modify: `packages/agent-runtime/src/plugins/compact.ts`
- Modify: `packages/agent-runtime/src/plugins/audit.ts`
- Test: `packages/agent-runtime/tests/state.test.ts`
- Test: `packages/agent-runtime/tests/storage.test.ts`
- Test: `packages/agent-runtime/tests/model.test.ts`
- Test: `packages/agent-runtime/tests/compact-plugin.test.ts`

**Interfaces:**
- Consumes: `createEntry`, `AgentMessage`, named `AgentChannel`.
- Produces: state persistence through `state` entries, clean model-message conversion.

- [ ] **Step 1: Update state/storage tests**

Ensure `tests/state.test.ts` asserts state entries have UUID ids and no turn relation:

```ts
expect(entries[0]).toMatchObject({
  type: "state",
  data: { version: 2 },
});
expect(entries[0].parentId).toBeUndefined();
```

- [ ] **Step 2: Update model tests for clean messages**

Remove any `meta` usage from `tests/model.test.ts`. Where custom conversion needs identity, use content or entry-level data instead.

- [ ] **Step 3: Fix storage imports**

In `packages/agent-runtime/src/storage.ts`, import types with `.js` suffixes:

```ts
import type { AgentEntry } from "./types/entry.js";
import type { AgentStorage } from "./types/storage.js";
```

- [ ] **Step 4: Update state manager**

In `packages/agent-runtime/src/state.ts`, use `createEntry("state", next)` from `entry.ts` and keep `resolveInitialState()` reading the latest `state` entry.

- [ ] **Step 5: Update model conversion**

In `packages/agent-runtime/src/model.ts`, remove all `message.meta` assumptions. Keep built-in role conversion and omit unconverted custom messages:

```ts
if (message.role === "custom") {
  const converted = await options.pluginHost.helpers.toModelMessages(message, options.context);
  result.push(...(converted as ModelMessage[]));
  continue;
}
```

- [ ] **Step 6: Update compact and audit plugins**

Adjust plugin code so compact summaries and audit entries use `createEntry()` and clean custom messages. Audit should subscribe to `"internal"` and match `event.type`.

- [ ] **Step 7: Verify Task 3**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/state.test.ts tests/storage.test.ts tests/model.test.ts tests/compact-plugin.test.ts
yarn turbo run check-types --filter=@yesimbot/agent-runtime
```

Expected: state/storage/model/compact tests pass or fail only on agent turn behavior not yet migrated.

**Commit point:** `git add packages/agent-runtime/src/storage.ts packages/agent-runtime/src/state.ts packages/agent-runtime/src/model.ts packages/agent-runtime/src/plugins packages/agent-runtime/tests/state.test.ts packages/agent-runtime/tests/storage.test.ts packages/agent-runtime/tests/model.test.ts packages/agent-runtime/tests/compact-plugin.test.ts && git commit -m "refactor(agent-runtime): align storage and model boundaries"` if committing is requested.

---

### Task 4: Agent Composition And Turn Lifecycle

**Files:**
- Modify: `packages/agent-runtime/src/agent.ts`
- Modify: `packages/agent-runtime/src/turn.ts`
- Modify: `packages/agent-runtime/src/tools.ts`
- Test: `packages/agent-runtime/tests/append.test.ts`
- Test: `packages/agent-runtime/tests/turn.test.ts`
- Test: `packages/agent-runtime/tests/busy.test.ts`
- Test: `packages/agent-runtime/tests/interrupt.test.ts`
- Test: `packages/agent-runtime/tests/tools.test.ts`

**Interfaces:**
- Consumes: helpers and types from Tasks 1-3.
- Produces: `createAgent(config): Agent`, UUID turn ids, named-channel turn streams, retained `TurnResult`.

- [ ] **Step 1: Update turn lifecycle tests**

Replace `event.name` assertions with `event.type` assertions for events produced by `run()`. Keep `run()` returning only turn-related internal events for the created turn.

- [ ] **Step 2: Update append tests**

Remove `message.meta` expectations. Assert `message.appended` outside a turn has no `turnId`, and turn-generated append events include `turnId` on the event only.

- [ ] **Step 3: Update busy/join tests**

For busy join, assert the joined message remains clean:

```ts
expect("turnId" in joinedMessage).toBe(false);
expect("meta" in joinedMessage).toBe(false);
```

Assert the active turn result still includes joined messages.

- [ ] **Step 4: Update turn queue ids**

In `packages/agent-runtime/src/turn.ts`, replace prefixed id generation with `createRuntimeId()` and ensure retained result behavior is unchanged.

- [ ] **Step 5: Rebuild agent event emission**

In `packages/agent-runtime/src/agent.ts`, add a local async `emitInternal(event)` helper:

```ts
const emitInternal = async (event: AgentCustomEvent["internal"]) => {
  await channel.emit("internal", createInternalEvent(event));
};
```

Buffer turn stream events by `event.turnId` only when the event has a `turnId`.

- [ ] **Step 6: Remove message mutation**

Delete helpers that set or read `message.meta.turnId`. Pass `turnId` explicitly to append helpers and event emission:

```ts
await appendEntries(messages.map(createMessageEntry), { turnId: request.turnId });
```

Use an options object for append pipeline internals rather than mutating messages.

- [ ] **Step 7: Serialize storage writes**

Inside `createAgent()`, introduce:

```ts
let storageReady = Promise.resolve();

const mutateStorage = async <T>(operation: () => Promise<T>): Promise<T> => {
  const next = storageReady.then(operation, operation);
  storageReady = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};
```

Use `mutateStorage()` for runtime-originated `storage.append()` and `storage.clear()` calls.

- [ ] **Step 8: Update step output persistence**

Create assistant/tool messages without `meta`. Emit `message.appended` with `turnId` when the append was turn-scoped.

- [ ] **Step 9: Update tool wrapping**

Keep tool events on `"internal"` with types `tool.start`, `tool.done`, `tool.failed`, and `tool.blocked`. Pass `turnId` through `ToolHookContext`.

- [ ] **Step 10: Verify Task 4**

Run:

```bash
yarn workspace @yesimbot/agent-runtime exec vitest run tests/append.test.ts tests/turn.test.ts tests/busy.test.ts tests/interrupt.test.ts tests/tools.test.ts
yarn turbo run check-types --filter=@yesimbot/agent-runtime
```

Expected: turn/append/busy/interrupt/tools tests pass and package type check is close to clean.

**Commit point:** `git add packages/agent-runtime/src/agent.ts packages/agent-runtime/src/turn.ts packages/agent-runtime/src/tools.ts packages/agent-runtime/tests/append.test.ts packages/agent-runtime/tests/turn.test.ts packages/agent-runtime/tests/busy.test.ts packages/agent-runtime/tests/interrupt.test.ts packages/agent-runtime/tests/tools.test.ts && git commit -m "refactor(agent-runtime): compose agent turn lifecycle"` if committing is requested.

---

### Task 5: Final Type Tests, Specs, And Verification

**Files:**
- Modify: `packages/agent-runtime/tests/types.test.ts`
- Modify: `packages/agent-runtime/tests/package-boundary.test.ts`
- Modify: `packages/agent-runtime/README.md` if public examples mention old event names or message metadata.
- Verify: `openspec/changes/repair-agent-runtime-type-migration/**`

**Interfaces:**
- Consumes: all implemented runtime APIs.
- Produces: final verified change ready for apply completion.

- [ ] **Step 1: Update declaration-merging tests**

In `tests/types.test.ts`, declare module augmentation against the new type files or package barrel as implemented. Custom messages should omit `meta`:

```ts
interface AgentCustomMessage {
  "example.custom": {
    role: "custom";
    type: "example.custom";
    content: { text: string };
    timestamp: number;
  };
}
```

Custom events should augment named channels and use `type`, not `name`.

- [ ] **Step 2: Update package boundary tests**

Keep existing package boundary assertions and add a check that source does not reference `AgentRuntime` if practical:

```ts
expect(content).not.toContain("AgentRuntime");
```

Do not add this assertion if it would match OpenSpec artifacts or comments outside `src`.

- [ ] **Step 3: Update README examples**

If `packages/agent-runtime/README.md` shows `event.name`, `message.meta`, or `AgentRuntime`, replace examples with named channel/event `type` usage:

```ts
agent.channel.subscribe("internal", (event) => {
  if (event.type === "turn.delta") console.log(event.delta);
});
```

- [ ] **Step 4: Run full package verification**

Run:

```bash
yarn turbo run check-types --filter=@yesimbot/agent-runtime
yarn turbo run test --filter=@yesimbot/agent-runtime
```

Expected: both commands pass.

- [ ] **Step 5: Run OpenSpec validation**

Run: `openspec validate repair-agent-runtime-type-migration --strict`

Expected: `Change 'repair-agent-runtime-type-migration' is valid`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- packages/agent-runtime openspec/changes/repair-agent-runtime-type-migration
```

Expected: diff is scoped to `agent-runtime` and this OpenSpec change, except for pre-existing unrelated worktree changes.

- [ ] **Step 7: Update task checkboxes**

Mark completed tasks in `openspec/changes/repair-agent-runtime-type-migration/tasks.md` after implementation and verification.

**Commit point:** `git add packages/agent-runtime openspec/changes/repair-agent-runtime-type-migration && git commit -m "fix(agent-runtime): complete type migration repair"` if committing is requested.

---

## Self-Review

- Spec coverage: Tasks cover clean messages, entry boundaries, named channels, turn-only `turnId` events, UUID ids, compositional `Agent`, storage ordering, plugin diagnostics, and focused verification.
- Placeholder scan: No TBD/TODO placeholders remain in the plan.
- Type consistency: The plan consistently uses `Agent`, `AgentMessage`, `AgentEntry`, `AgentCustomEvent`, `internal`, `stream`, `event.type`, and UUID ids.
