<!--
Raw capture of superpowers:brainstorming output.

This artifact captures the collaborative exploration that led to the design
decisions for repairing the agent-runtime type migration. design.md will
reorganize this content into structured Context / Goals / Decisions / Risks /
Migration sections.
-->

# Brainstorm: Repair agent-runtime type migration

## Background

`packages/agent-runtime` is currently between two designs:

- The first Athena runtime design used message-centered history with
  `AgentMessage.meta.id`, `AgentMessage.meta.timestamp`, and optional
  `AgentMessage.meta.turnId`.
- The ongoing migration is moving toward an Apeira-inspired structure where
  runtime capabilities are composed from small primitives: storage, channel,
  state manager, queue/turn runner, plugin host, model boundary, and tools.

The migration is incomplete. `src/id.ts` and `src/message.ts` were deleted while
imports still reference them; public types were split into `src/types/*` without
stable re-exports; `AgentMessage` no longer carries `meta` but runtime code and
tests still assume it does; event/channel types are partly named-channel based
while runtime code still emits event-name objects.

The goal is to repair the package without adapting `core` in this change.

## Explored Options

### Option A: Restore the old message metadata model

Restore `AgentMessage.meta` and keep `message.meta.turnId` as the main turn
association mechanism.

Pros:

- Minimal changes to the first-version tests.
- Keeps `waitTurn`, append, and model boundary code close to the earlier
  implementation.

Cons:

- Conflicts with the user's protected type direction: message should no longer
  carry runtime metadata.
- Keeps storage/runtime identity mixed into semantic message content.
- Repeats the old design rather than completing the Apeira-style migration.

Rejected.

### Option B: Put turn association on `AgentEntry.parentId`

Keep `AgentMessage` clean and encode turn membership by storing turn-generated
message entries with `parentId = turnId`.

Pros:

- Keeps message metadata out of message content.
- Allows storage queries to recover turn-associated entries.
- Reuses an existing `AgentEntry` field.

Cons:

- `parentId` is intended for tree-shaped entry relationships, not turn
  membership.
- Overloading it now would make future branch/fork/causal history semantics
  ambiguous.

Rejected after discussion. `AgentEntry.parentId` stays reserved for tree-shaped
relationships.

### Option C: Keep turn association in runtime events and turn results only

Keep `AgentMessage` free of runtime metadata and do not use `AgentEntry.parentId`
for turn ownership. Use `TurnResult.turnId`, runtime queue state, hook contexts,
and turn-related internal events to carry turn identity.

Pros:

- Cleanest boundary: message is semantic content; entry is persistent envelope;
  event is runtime fact.
- Avoids overloading `parentId`.
- Keeps first-version storage append-only and chronological without promising
  turn reconstruction from message entries.
- Fits the current scope: no turn audit UI, no turn replay, no retained result
  restoration from storage.

Cons:

- A later feature that needs restart-safe turn reconstruction will need explicit
  turn entries, event entries, or a dedicated metadata field.

Selected.

## Confirmed Decisions

1. Use the `superpowers-bridge` OpenSpec schema for this change.
2. Delete the accidentally created `spec-driven` change and recreate it with the
   correct schema.
3. `AgentMessage` does not carry `meta` and does not carry `turnId`.
4. `AgentEntry.parentId` is reserved for tree-shaped relationships and is not
   used for turn membership.
5. `AgentCustomEntry.message` is `AgentMessage`, not `AgentMessage[keyof
   AgentMessage]`.
6. Runtime-generated ids such as turn ids, entry ids, and event ids use
   `crypto.randomUUID()`.
7. `AgentChannel` uses named channels. Core runtime events use the `internal`
   channel; stream parts use the `stream` channel.
8. Only turn-related internal events carry `turnId`. Non-turn events such as
   `agent.init`, `agent.stop`, and `plugin.disabled` do not require it.
9. `message.appended` carries `turnId` only when the append is turn-related; a
   normal observation append has no `turnId`.
10. Message helper functions do not generate message ids because messages no
    longer own runtime identity.
11. The code structure should be redesigned instead of keeping compatibility
    modules as the main organization.
12. Remove the public `AgentRuntime` type rather than aliasing it. Export a
    compositional `Agent` interface.
13. Storage writes should be serialized inside the runtime to preserve
    append-only ordering under active turns and state/event writes.
14. Update `agent-runtime-core`, `agent-plugin-system`, and
    `agent-storage-session` specs. Do not adapt `core` in this change.

## Architecture Shape

The intended package shape is domain-oriented:

```text
packages/agent-runtime/src/
  agent.ts             createAgent composition root and public Agent interface
  channel.ts           named channel primitive
  event.ts             internal event construction helpers
  entry.ts             entry construction helpers
  message.ts           message construction helpers
  id.ts                UUID helper
  model.ts             AgentMessage -> ai ModelMessage boundary
  plugin.ts            plugin host and hook composition
  state.ts             state manager
  storage.ts           memory storage
  tools.ts             tool merge and ai ToolSet conversion
  turn.ts              turn queue/result lifecycle
  types/
    event.ts
    entry.ts
    message.ts
    plugin.ts
    state.ts
    storage.ts
```

Compatibility imports such as `../src/message.js` may remain valid because the
module still exists, but the module should implement the new message model
rather than recreating old metadata.

## Event Model

`AgentChannel` shape:

```ts
emit(channel, event, options?)
subscribe(channel, listener)
```

Core channels:

- `internal`: runtime lifecycle, turn, message, tool, and plugin diagnostic
  events.
- `stream`: raw or near-raw streaming model parts when useful.

Internal event principles:

- Events have stable `type` values such as `turn.queued`, `turn.start`,
  `turn.done`, `message.appended`, `plugin.error`.
- Turn-related events include `turnId`.
- Non-turn events do not fake or require `turnId`.
- Runtime event ids are UUIDs when a persisted or constructed event envelope
  needs identity.

## Storage Model

`AgentStorage` stays minimal:

```ts
append(...entries)
read()
clear()
```

`AgentEntry` is the persistence envelope:

- `id`: UUID entry identity.
- `type`: entry domain.
- `data`: typed payload.
- `timestamp`: append-time timestamp.
- `parentId`: reserved for tree-shaped entry relationships.

The runtime does not promise that turn membership can be reconstructed from
message entries alone in this version. If that requirement appears later, it
should be modeled explicitly instead of backfilling `AgentMessage.turnId`.

## Runtime Composition

`createAgent()` should assemble:

- storage
- named channel
- state manager
- plugin host
- turn queue
- model execution boundary
- tool wrapping/hooks

The exported `Agent` interface should expose those capabilities directly and
intentionally. It should not rely on inheritance hierarchies, and `AgentRuntime`
should be removed.

## Testing Focus

Tests should cover:

- message helpers create clean messages without `meta`;
- entry helpers create UUID entry ids and preserve message data;
- memory storage append/read/clear;
- named channel subscribe/emit and custom event typing;
- state updates persist state entries;
- turn lifecycle, retained `TurnResult`, interruption, busy defer/join/reject;
- `message.appended` turnId behavior for turn vs non-turn appends;
- plugin hooks and plugin diagnostic events on the `internal` channel;
- custom message/entry/state/event declaration merging under the new surfaces.

## Open Questions Resolved

No unresolved design questions remain before proposal/spec/task/plan generation.
The implementation may still reveal local type details, but those should be
handled within the confirmed boundaries above rather than reopening the message
metadata design.
