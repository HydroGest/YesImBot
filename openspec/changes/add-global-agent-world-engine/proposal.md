## Why

YesImBot Core can host one Agent per admitted channel, but it cannot host a persistent subject whose identity, world time, and tool-driven activity span several chat channels. YesImBotWorld proved that phone-mediated messaging, delayed actions, world arbitration, and offline continuity produce a coherent narrative. This change brings those capabilities into the current architecture without assigning world state or world-specific lifecycle semantics to Core.

## What Changes

**Global Agent hosting**
- From: Core creates Agents only through channel-bound runtimes that require a real Bot, ChannelScope, Will decision, channel assets, and an output delivery target.
- To: Core also hosts explicitly started GlobalAgents under stable `GlobalScope` identities, with separate runtime, storage, lifecycle, and a dedicated `ctx.yesimbot.global` facade.
- Reason: Persistent non-Gateway Agents need Core session, model, tool, compaction, and stop behavior without pretending to be platform channels.
- Impact: Additive public Core capability; existing ChannelScope and ChannelRuntime behavior remains unchanged.

**WorldEngine plugin**
- Add an optional WorldEngine plugin that owns one persistent WorldAgent, private narrative world state, phone conversations, an affine TU clock, delayed activities, scheduling, and a stateless WorldArbiter.
- Keep accepted platform messages in the existing channel pipeline. WorldEngine records configured messages in its private phone view and submits only minimal notifications to its GlobalAgent.
- Require WorldAgent actions and outgoing chat to use WorldEngine tools. Assistant text has no automatic platform or world effect.

**Lifecycle and persistence**
- Store GlobalAgent roots under `agents/<agentId>/` with an authoritative Manifest, Core-owned `sessions/` and `assets/`, and preserved domain-owned children.
- Stop GlobalAgents without deleting data. Require a complete resource definition for every later start. Clear only Core session and asset data.
- Reuse the existing AssetService for ChannelScope and GlobalScope stores.

**Scope control**
- Keep ChannelRuntime and GlobalRuntime as sibling modules that compose private runtime-pool and session-lifecycle implementations.
- Defer registered ecosystem plugin discovery, configured plugin selection, Advisor integration, legacy YesImBotWorld migration, custom calendars, and a general world-object framework.

## Capabilities

### New Capabilities

- `global-agent-hosting`: Stable GlobalScope identity, explicit GlobalAgent lifecycle, custom-message submission, session and asset ownership, and the `ctx.yesimbot.global` facade.
- `world-engine-runtime`: WorldAgent phone perception, private narrative state, TU clock, delayed activities, WorldArbiter adjudication, and offline continuity.

### Modified Capabilities

- `core-runtime-integration`: Core gains a parallel GlobalRuntimeManager and includes GlobalRuntime shutdown in its existing service lifecycle without changing channel routing.
- `channel-storage-protocol`: The single public AssetService also creates stores for GlobalScope while retaining the existing channel storage contract.

## Impact

Core runtime, storage, session, asset, model-resolution, and service-facade modules gain GlobalAgent hosting responsibilities. A new optional WorldEngine plugin consumes accepted channel observations and owns all world-specific state and scheduling. `@yesimbot/agent-runtime` keeps its existing Agent, custom-message, plugin, tool, and storage contracts. Existing channel plugins, Gateway behavior, ChannelScope identity, channel JSONL, and platform delivery remain unchanged. No legacy data is read or migrated.
