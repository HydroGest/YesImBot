## Why

Athena now has a small `@yesimbot/agent-runtime`, but `core` is still only a prototype integration. Reimplementing `koishi-plugin-yesimbot` around that runtime will stabilize the Koishi adapter boundary, avoid restoring the old heavy core architecture, and provide a minimal persistent group-chat agent foundation.

## What Changes

**Core Runtime Integration**
- From: `core` has a minimal prototype that mixes Koishi lifecycle, runtime creation, prompt loading, message conversion, trigger policy, and reply rendering in one place.
- To: `core` becomes a small Koishi host adapter with a `ctx.yesimbot` service, per-channel runtime management, JSONL storage, prompt file injection, message routing, reset, and dispose handling.
- Reason: The runtime should own agent orchestration while `core` owns Koishi integration.
- Impact: New core service API and clearer extension boundary for Koishi plugins.

**Extension Boundary**
- From: Future extension direction is unclear between old core extensions and runtime plugins.
- To: External Koishi plugins register per-channel `AgentPlugin` factories through `ctx.yesimbot.registerAgentPlugin(factory)`.
- Reason: Koishi should manage global plugin lifecycle, while runtime plugins should be channel-isolated.
- Impact: Extension authors get Koishi access through normal Koishi plugins and runtime behavior changes through `AgentPlugin`.

**Runtime Turn Semantics**
- From: Runtime has `append()`, `send()`, `run()`, and `waitTurn()`, but no explicit interrupt API and no specified active-turn observation visibility semantics.
- To: Runtime supports `interrupt()` and makes active-turn appended observations visible at safe model boundaries without treating them as joined explicit input.
- Reason: Reset and group-chat observation both need runtime-owned semantics.
- Impact: `@yesimbot/agent-runtime` gains small API and lifecycle behavior changes.

**Persistent Channel Storage**
- From: The prototype uses in-memory storage.
- To: Each channel runtime uses one append-only JSONL file under the unified `basePath`.
- Reason: The first usable core needs restart persistence and reset behavior without a full session manager.
- Impact: Adds a minimal core-owned storage adapter and per-channel file naming.

## Capabilities

### New Capabilities

- `core-runtime-integration`: Defines the Koishi core service, per-channel runtime lifecycle, plugin factory registration, channel message routing, prompt file injection, JSONL storage, reset, reply rendering, and error behavior.

### Modified Capabilities

- `agent-runtime-core`: Adds interrupt semantics and active-turn append observation visibility at safe model boundaries.

## Impact

- Affects `core/` as the main `koishi-plugin-yesimbot` runtime integration.
- Affects `packages/agent-runtime/` for `interrupt()` and active-turn append semantics.
- Adds or updates core tests for message routing, plugin registration, JSONL persistence, reset, prompt ordering, and reply rendering.
- Keeps provider packages on the existing `ctx["yesimbot.model"]` registration boundary.
- Does not migrate legacy core extensions, legacy plugins, multimodal parsing, memory systems, compact-by-default behavior, or old session data.
