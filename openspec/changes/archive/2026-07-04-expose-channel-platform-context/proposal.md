## Why

Platform-specific tools need stable access to adapter capabilities such as OneBot `bot.internal`, but the current factory context only exposes channel metadata. This change lets core provide a narrow channel-scoped platform context while keeping `agent-runtime` host-agnostic and avoiding generic context expansion.

## What Changes

**Channel Agent Context**
- From: `ChannelAgentContext` exposes only `channel` metadata.
- To: `ChannelAgentContext` also exposes `platform.name` and optional `platform.unsafeBot`.
- Reason: Adapter-specific plugins can build channel-scoped tool closures from the first Koishi session's bot.
- Impact: Non-breaking addition for external plugin factories.

**Runtime Boundary**
- From: Platform-specific plugins would need ad hoc access to Koishi state or broader runtime context changes.
- To: Plugins receive stable platform capabilities from core and keep private plugin context in closures.
- Reason: OneBot tools need `bot.internal`, but `agent-runtime` should not know about Koishi.
- Impact: No public `agent-runtime` API change.

**State Boundary**
- From: Channel identity and platform handles could be confused with runtime state.
- To: `platform`, `selfId`, `channelId`, and `unsafeBot` remain core context, not `agent.state`.
- Reason: They are host/runtime resources, not persisted semantic agent state.
- Impact: Clarifies API usage for plugin authors.

**OneBot Utils Migration**
- From: legacy `onebot-utils` registers tools through the removed extension context and reads `ctx.platform.bot.internal`.
- To: a new `plugins/onebot-utils` package registers an `AgentPlugin` through `ctx.yesimbot.registerAgentPlugin` and reads `context.platform.unsafeBot.internal` through plugin-owned closures.
- Reason: This validates `unsafeBot` with a real adapter-specific plugin while keeping `agent-runtime` unchanged.
- Impact: Adds one optional Koishi plugin package and does not change core runtime behavior for non-OneBot channels.

## Capabilities

### New Capabilities

- `onebot-utils`: Migrated OneBot adapter utility tools exposed through the new agent plugin factory framework.

### Modified Capabilities

- `core-runtime-integration`: Extend the registered agent plugin factory context with a core-owned platform section containing `name` and optional `unsafeBot`, and clarify that raw Koishi objects remain outside `agent-runtime`.

## Impact

- `core/src/shared/types.ts`: Extend `ChannelAgentContext` and import Koishi `Bot` as a type.
- `core/src/service.ts`: Populate `platform.name` and `platform.unsafeBot` from the first session used to create a channel runtime.
- `core/tests/service.test.ts`: Update test fixtures and add coverage that plugin factories receive the platform context.
- `openspec/specs/core-runtime-integration`: Requirement delta for plugin factory context shape and boundary rules.
- `plugins/onebot-utils`: New optional Koishi plugin package migrated from `references/#legacy/plugins/onebot-utils`.
- `package.json` workspace discovery: no change expected because `plugins/*` is already included.
