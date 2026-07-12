## Why

`packages/agent-runtime` is mid-migration toward a compositional runtime design, but the type split and event/channel rewrite are incomplete. This now blocks TypeScript compilation and leaves the runtime architecture ambiguous around message metadata, turn association, storage entries, and public APIs.

## What Changes

**Message runtime metadata**
- From: `AgentMessage` and tests still assume runtime metadata such as `meta.id`, `meta.timestamp`, and `meta.turnId`.
- To: `AgentMessage` is semantic content only and does not carry `meta` or `turnId`.
- Reason: Runtime identity and turn lifecycle belong to runtime envelopes/events, not semantic message values.
- Impact: Breaking for consumers that read `AgentMessage.meta`.

**Entry turn association**
- From: `AgentEntry.parentId` was considered as a possible place to store `turnId`.
- To: `parentId` is reserved for tree-shaped entry relationships and is not used for turn membership.
- Reason: Overloading `parentId` would make future branch/fork or causal entry relations ambiguous.
- Impact: Turn membership is not reconstructable from message entries alone in this version.

**Event and channel model**
- From: Runtime code still emits event-name objects while type files are partially migrated to named channels.
- To: `AgentChannel` uses named channels. Core runtime events use `internal`; stream parts use `stream`.
- Reason: Named channels match the Apeira-inspired design and allow custom plugin communication without hook registration.
- Impact: Tests and plugin diagnostics must subscribe by channel and inspect event `type`.

**Turn id ownership**
- From: `turnId` was present or expected on message metadata.
- To: Only turn-related internal events, hook contexts, queue state, and `TurnResult` carry `turnId`.
- Reason: This keeps message and storage boundaries clean while retaining turn observability.
- Impact: No `turnId` on messages; non-turn events do not fake a turn id.

**Runtime identifiers**
- From: Runtime ids use simple prefixed counters.
- To: Runtime-generated ids such as turn ids, entry ids, and event ids use `crypto.randomUUID()`.
- Reason: UUIDs avoid process-local counter collision and match durable append-only log expectations.
- Impact: Tests must assert UUID shape or stable behavior rather than prefixed counters.

**Public runtime surface**
- From: The package exposes or references `AgentRuntime` and has partially duplicated local agent types.
- To: The package exports a compositional `Agent` interface and removes `AgentRuntime`.
- Reason: The runtime is assembled from channel, storage, state, queue/turn, plugin, model, and tool capabilities rather than inheritance.
- Impact: `AgentRuntime` type consumers must migrate to `Agent`.

**Code organization**
- From: Types were moved into `types/`, but helpers and public exports are broken.
- To: Rebuild the package around domain modules (`message`, `entry`, `event`, `channel`, `state`, `storage`, `turn`, `plugin`, `model`, `tools`, `agent`) and focused type files.
- Reason: Keep KISS/SOLID boundaries clear and avoid piling all definitions back into one file.
- Impact: Internal imports, tests, and spec expectations are updated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-runtime-core`: Message metadata, turn lifecycle, UUID ids, compositional `Agent`, and runtime helper behavior change.
- `agent-plugin-system`: Named channels and internal event typing change; only turn-related events carry `turnId`.
- `agent-storage-session`: Entry typing and storage metadata semantics change; message entries contain `AgentMessage`, and `parentId` stays reserved for tree-shaped relationships.

## Impact

- Affected code: `packages/agent-runtime/src` and `packages/agent-runtime/tests`.
- Affected specs: `agent-runtime-core`, `agent-plugin-system`, `agent-storage-session`.
- Public API impact: removes `AgentRuntime`, removes message `meta`, uses named channel events, changes generated id format to UUID.
- No new runtime dependencies are expected; use `crypto.randomUUID()`.
- Out of scope: adapting `core`, legacy `packages/agent` data migration, retry policy, HITL, session branching, and turn reconstruction from persisted message entries.
