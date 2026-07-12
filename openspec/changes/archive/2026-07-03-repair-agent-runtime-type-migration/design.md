## Context

Athena is extracting a new `@yesimbot/agent-runtime` package from the older agent implementation while borrowing several mature ideas from Apeira core: small primitives, append-only storage, typed named channels, plugin hooks, state management, and queue-driven turn execution.

The current `packages/agent-runtime` tree is mid-migration. Some source modules were deleted while imports still reference them, public types were split without a stable re-export surface, the runtime still expects `AgentMessage.meta`, and event/channel code is split between the old event-name model and the new named-channel model.

Important constraints:

- Do not adapt `core` in this change.
- Do not restore runtime metadata onto `AgentMessage`.
- Do not use `AgentEntry.parentId` for turn membership; it is reserved for tree-shaped entry relationships.
- Keep types split by domain under `types/`.
- Prefer clear interfaces and composition over inheritance.
- Preserve user changes already made in the worktree.

## Goals / Non-Goals

**Goals:**

- Restore `@yesimbot/agent-runtime` TypeScript compilation.
- Complete the migration to clean message, entry, event, channel, state, storage, plugin, turn, and agent boundaries.
- Keep `AgentMessage` as semantic message content without `meta` or `turnId`.
- Use named `AgentChannel` channels for runtime and plugin events.
- Carry `turnId` only in turn-related internal events, turn results, hook contexts, and runtime queue state.
- Use UUIDs for runtime-generated identifiers.
- Export a compositional `Agent` interface and remove `AgentRuntime`.
- Update tests and specs to cover the repaired behavior.

**Non-Goals:**

- Do not adapt `core` or provider plugins.
- Do not migrate old `packages/agent` session data.
- Do not add retry policy, HITL, branch/fork/rebase session behavior, or turn replay.
- Do not promise that turn membership can be reconstructed from message entries alone.
- Do not introduce a new id dependency.

## Decisions

### D1: Keep messages free of runtime metadata

- **Choice**: `AgentMessage` does not carry `meta`, `id`, or `turnId`.
- **Rationale**: A message is semantic model/platform content. Runtime identity and lifecycle metadata are separate concerns.
- **Alternatives considered**: Restoring `AgentMessage.meta` would compile existing tests faster but conflicts with the new type direction and keeps runtime metadata mixed into message content.

### D2: Reserve `AgentEntry.parentId` for tree-shaped relationships

- **Choice**: Do not store turn membership in `entry.parentId`.
- **Rationale**: `parentId` is already the natural place for future tree-shaped entry relationships. Using it for turns would create ambiguous semantics.
- **Alternatives considered**: `parentId = turnId` was rejected because it overloads one field with two concepts.

### D3: Do not persist first-version turn membership on message entries

- **Choice**: Turn association exists in runtime queue state, hook contexts, `TurnResult.turnId`, and turn-related internal events.
- **Rationale**: The current runtime does not need restart-safe turn replay or per-turn storage reconstruction. Avoid adding metadata before a real caller needs it.
- **Alternatives considered**: Adding `turnId` to entries or messages was rejected for this change. If needed later, add an explicit turn entry/event model or a dedicated entry metadata field.

### D4: Use named channels

- **Choice**: `AgentChannel` exposes `emit(channel, event, options?)` and `subscribe(channel, listener)`.
- **Rationale**: Named channels separate event transport from event taxonomy and support custom plugin communication without new hook APIs.
- **Alternatives considered**: The old `subscribe(event.name)` model was simpler for core lifecycle events but does not generalize as well to custom channels.

### D5: Core runtime events live on the `internal` channel

- **Choice**: Runtime lifecycle, turn, message, tool, and plugin diagnostic events use `internal`; streaming parts use `stream`.
- **Rationale**: This keeps a small stable core channel while preserving room for raw stream events.
- **Alternatives considered**: One channel per event family was rejected as unnecessary for the first version.

### D6: Only turn-related events carry `turnId`

- **Choice**: Events such as `turn.queued`, `turn.start`, `turn.done`, tool events, and turn-scoped `message.appended` carry `turnId`; `agent.init`, `agent.stop`, and plugin diagnostics do not require it.
- **Rationale**: Non-turn events should not fake a turn association.
- **Alternatives considered**: Requiring `turnId` on all internal events was rejected because it made non-turn events invalid.

### D7: Generate runtime ids with UUIDs

- **Choice**: Use `crypto.randomUUID()` for generated turn ids, entry ids, and event ids.
- **Rationale**: UUIDs avoid process-local counter collisions and fit durable append-only storage.
- **Alternatives considered**: Prefixed counters were rejected because they are only process-local and already leaked into tests as implementation details.

### D8: Rebuild domain modules instead of centralizing all types

- **Choice**: Keep focused type files under `types/` and matching domain helpers in source modules: `message.ts`, `entry.ts`, `event.ts`, `id.ts`, `channel.ts`, `state.ts`, `storage.ts`, `turn.ts`, `plugin.ts`, `model.ts`, `tools.ts`, and `agent.ts`.
- **Rationale**: The package remains readable by domain boundary and avoids rebuilding a large `types.ts`.
- **Alternatives considered**: Re-exporting everything from one monolithic type file was rejected; a root `types.ts` may re-export public surfaces but should not own every definition.

### D9: Export `Agent`, remove `AgentRuntime`

- **Choice**: `createAgent()` returns `Agent`; `AgentRuntime` is removed rather than aliased.
- **Rationale**: The new design is a runtime composition, not a legacy runtime class or inheritance target.
- **Alternatives considered**: Keeping `AgentRuntime = Agent` would reduce breakage but preserve an outdated concept.

### D10: Serialize runtime storage writes

- **Choice**: Runtime-originated storage mutations are sequenced so active-turn appends, state writes, and persisted events keep append-only order.
- **Rationale**: Chronological storage is a core behavior and should not depend on incidental promise scheduling.
- **Alternatives considered**: Letting all writes race was rejected because it makes model context construction and tests flaky.

### D11: Keep plugin hooks as behavior changes and channels as observation

- **Choice**: Ordered hooks still transform entries/messages, tools, prompts, and tool calls. Channels remain event/communication surfaces.
- **Rationale**: Hooks return values and require deterministic ordering; channels should not be used for reducer-style behavior.
- **Alternatives considered**: Channel-only behavior changes were rejected because they make execution order and return values unclear.

### D12: Update tests around the new contract

- **Choice**: Tests should assert clean messages, UUID entry ids, named channel events, turn-scoped event `turnId`, storage ordering, plugin hooks, and custom declaration merging.
- **Rationale**: The migration changes public semantics, so tests must describe the new behavior rather than force old metadata back in.
- **Alternatives considered**: Only fixing compile errors was rejected because it would leave missing behavior and ambiguous architecture.

## Risks / Trade-offs

[Risk] Removing message `meta` breaks consumers that rely on `message.meta.id` or `message.meta.turnId`. → Mitigation: update package tests/specs now and leave core adaptation out of this change.

[Risk] Turn membership cannot be reconstructed from message entries alone. → Mitigation: accept this first-version scope and add explicit turn/event persistence later if a real replay or audit feature needs it.

[Risk] Named channel migration touches many tests and plugin diagnostics. → Mitigation: keep only two core channels (`internal`, `stream`) and avoid a large event bus abstraction.

[Risk] Storage serialization can become a hidden bottleneck. → Mitigation: serialize only runtime storage mutations needed for append-only order; do not add locks outside this package.

[Trade-off] Removing `AgentRuntime` is more breaking than aliasing it. → Accepted because the name preserves old architecture assumptions and the package is still experimental.

## Migration Plan

1. Repair the type surface: domain type files, public exports, `Agent` interface, and removal of `AgentRuntime`.
2. Restore helper modules with new semantics: UUID id helpers, message constructors without `meta`, entry/event constructors with UUID envelope ids.
3. Convert channel/event/runtime code to named channels and turn-only `turnId` events.
4. Update agent, turn queue, model conversion, plugin host, tools, storage, and state modules to the new types.
5. Update tests to describe the new behavior and add missing coverage for custom extension surfaces and event turnId boundaries.
6. Update delta specs for `agent-runtime-core`, `agent-plugin-system`, and `agent-storage-session`.
7. Verify with package-scoped type checks and tests.

Rollback strategy:

- This change is local to `packages/agent-runtime` and OpenSpec artifacts. If the design proves wrong during implementation, revert the change branch or restore from version control before adapting `core`.

## Open Questions

None before implementation. If implementation exposes a need for persisted turn reconstruction, that should become a separate future design rather than adding `turnId` to `AgentMessage`.
