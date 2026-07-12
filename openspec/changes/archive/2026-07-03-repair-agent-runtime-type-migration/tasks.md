## 1. Type Surface And Module Boundaries

- [x] 1.1 Rebuild public type exports so domain types under `src/types/` are importable from the package root where intended.
- [x] 1.2 Define the compositional public `Agent` interface and remove the public `AgentRuntime` type.
- [x] 1.3 Align `AgentMessage` and custom message declaration merging with the no-`meta`, no-`turnId` contract.
- [x] 1.4 Align `AgentEntry` and custom entry declaration merging so message entries contain `AgentMessage` and `parentId` remains tree-only.
- [x] 1.5 Align internal event types so only turn-related events require `turnId`.

## 2. Runtime Helper Modules

- [x] 2.1 Restore or recreate `id.ts` with UUID-based id generation using `crypto.randomUUID()`.
- [x] 2.2 Restore or recreate `message.ts` constructors that create semantic messages without runtime ids or `meta`.
- [x] 2.3 Add or update `entry.ts` constructors that create UUID-backed entries for messages, state, events, and custom entry data.
- [x] 2.4 Add or update `event.ts` helpers for internal event construction without requiring `turnId` on non-turn events.

## 3. Named Channel And Plugin Host

- [x] 3.1 Finalize `AgentChannel` as `emit(channel, event, options?)` and `subscribe(channel, listener)`.
- [x] 3.2 Update core runtime event emission to use the `internal` channel and stream emission to use the `stream` channel.
- [x] 3.3 Update plugin diagnostics to emit `plugin.error` and `plugin.disabled` on the `internal` channel with the new event shape.
- [x] 3.4 Preserve deterministic plugin hook ordering and error policies under the new types.

## 4. Agent, Turn, Storage, State, Model, And Tool Behavior

- [x] 4.1 Update `createAgent()` to compose storage, channel, state manager, plugin host, turn queue, model boundary, and tool wrapping through the new interfaces.
- [x] 4.2 Update turn queue ids, retained results, busy behavior, `run()` streams, and `interrupt()` to use UUID turn ids and turn-scoped events.
- [x] 4.3 Update append and step-output persistence so messages are never mutated with runtime metadata.
- [x] 4.4 Serialize runtime-originated storage writes to preserve append-only ordering.
- [x] 4.5 Update model-message conversion to use clean `AgentMessage` values and omit unconverted custom messages.
- [x] 4.6 Update tool wrapping and tool hook contexts to carry turn id through context/events rather than messages.

## 5. Tests And Specifications

- [x] 5.1 Update message and entry helper tests for clean messages and UUID entry ids.
- [x] 5.2 Update channel, plugin, and event tests for named channels and turn-only `turnId` events.
- [x] 5.3 Update storage and state tests for entry semantics, parentId boundaries, and serialized write behavior.
- [x] 5.4 Update turn, busy, interrupt, append, model, and tools tests for no message metadata and retained turn behavior.
- [x] 5.5 Update declaration-merging type tests for custom message, entry, state, and event surfaces.
- [x] 5.6 Run OpenSpec validation for the change.
- [x] 5.7 Run package-scoped type check and tests for `@yesimbot/agent-runtime`.
