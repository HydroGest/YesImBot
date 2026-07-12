## Context

Core currently creates one `@yesimbot/agent-runtime` agent per `platform + selfId + channelId` key and calls registered `AgentPluginFactory` functions when the channel runtime is first created. The factory context contains stable channel metadata, but it does not expose platform capabilities from Koishi.

Some adapter-specific plugins need channel-scoped raw platform access. The legacy `onebot-utils` plugin is the concrete example: it needs OneBot `bot.internal` to fetch forward messages, create reactions, and set essence messages. These capabilities are stable enough to capture when the channel runtime is created, but they are also high-authority and host-specific.

The design must keep `agent-runtime` focused on turn execution, tool execution, storage, state, and hooks. It should not receive Koishi `Context`, Koishi `Session`, raw `Bot`, or adapter-specific internals through its public tool execution context.

## Goals / Non-Goals

**Goals:**

- Expose stable channel-scoped platform context to core agent plugin factories.
- Allow platform-specific plugins to access the raw Koishi bot through an explicit unsafe escape hatch.
- Keep platform-specific plugin context private to each plugin instance through closures.
- Migrate the legacy OneBot utility tools as the first concrete consumer of `platform.unsafeBot`.
- Preserve existing `agent-runtime` public APIs and host-agnostic boundary.
- Make clear that channel identity and raw bot handles are not `agent.state`.

**Non-Goals:**

- Do not genericize `AgentConfig`, `AgentPlugin`, `AgentToolExecuteContext`, or hook contexts.
- Do not introduce a capability registry in this change.
- Do not expose Koishi `Session` to tools or runtime hooks.
- Do not hot-swap platform context for already-created channel runtimes.
- Do not migrate the incomplete legacy `onebot_get_message_id` placeholder in the first version.

## Decisions

### D1: Extend core `ChannelAgentContext`, not `agent-runtime`

- **Choice:** Add a `platform` section to core-owned `ChannelAgentContext`.
- **Rationale:** The need comes from Koishi/platform integration, not generic runtime tool execution. Keeping the change in core avoids reintroducing host-specific concepts into `agent-runtime`.
- **Alternatives considered:** Generic host/turn context across runtime types was rejected because it expands public runtime API for a core-specific use case and would make ordinary plugins carry unnecessary type complexity.

### D2: Expose raw bot as `platform.unsafeBot`

- **Choice:** Use `unsafeBot?: Bot` rather than `bot?: Bot`.
- **Rationale:** The raw Koishi bot is powerful and not permission-filtered by YesImBot. The name should signal that plugin authors are stepping outside the safe, channel-scoped abstraction.
- **Alternatives considered:** A capability registry such as `platform.getCapability("onebot.internal")` was deferred. It may be useful later, but it adds a registry model before there are enough concrete capability families.

### D3: Capture `unsafeBot` when creating the channel runtime

- **Choice:** Populate `unsafeBot` from the first eligible Koishi `Session` used to create the channel runtime.
- **Rationale:** Agent/plugin lifecycle is pre-channel, and `platform`, `channel`, and `bot` are treated as stable within that lifecycle. This matches current lazy runtime creation.
- **Alternatives considered:** Looking up the current session during tool execution was rejected because sessions are request-scoped and would blur stable and dynamic state.

### D4: Plugin-owned closure context is the supported usage pattern

- **Choice:** Platform plugins build their own private context inside the factory and return tools that close over that context.
- **Rationale:** This keeps plugin context scoped to the plugin instance and avoids shared mutable context injection across plugins.
- **Alternatives considered:** Shared mutable context injection was rejected because it creates ordering dependencies, name collisions, and cross-plugin authority leaks.

### D5: Keep channel/platform identity out of `agent.state`

- **Choice:** `platform`, `selfId`, `channelId`, and `unsafeBot` remain core context and are not represented as persisted runtime state.
- **Rationale:** `agent.state` is mutable persisted semantic state. Bot handles are non-serializable host resources, and channel identity already exists in runtime keys, storage paths, platform messages, and `ChannelAgentContext`.
- **Alternatives considered:** Mirroring platform data into `agent.state` was rejected because it creates duplicate sources of truth and lets plugins accidentally mutate identity.

### D6: Migrate OneBot utils as a separate optional plugin package

- **Choice:** Add `plugins/onebot-utils` as a Koishi plugin package that injects `yesimbot`, registers an agent plugin factory, and returns tools only for `context.channel.platform === "onebot"`.
- **Rationale:** The plugin is adapter-specific and optional. Keeping it outside core preserves the core/runtime boundary and gives `unsafeBot` a real dogfood consumer.
- **Alternatives considered:** Building OneBot helpers into core was rejected because core should not depend on a specific adapter. Keeping the legacy extension plugin was rejected because the new framework no longer uses `yesimbot.extension`.

### D7: Migrate only completed OneBot tools

- **Choice:** Migrate `onebot_get_forward_message`, `onebot_create_reaction`, and `onebot_set_essence`; leave the unfinished `onebot_get_message_id` out of scope.
- **Rationale:** The legacy `onebot_get_message_id` tool has no completed behavior after destructuring input. YAGNI favors migrating only behavior with clear execution semantics.
- **Alternatives considered:** Keeping a placeholder tool was rejected because it would expose a tool that cannot produce a meaningful result.

## Risks / Trade-offs

[Risk] `unsafeBot` can be used to perform high-authority adapter operations beyond the current channel. → Mitigation: Name it `unsafeBot`, document that plugins must perform platform checks, and keep it out of `agent-runtime`.

[Risk] A bot instance may change after a channel runtime is created. → Mitigation: Existing runtimes keep their original plugin instances; reset/recreate refreshes context. This matches the current no-hot-swap policy.

[Risk] Plugin authors may treat `unsafeBot` as a general safe API. → Mitigation: Tests and docs should demonstrate it only as an escape hatch for adapter-specific plugins.

[Risk] OneBot internal API typing may be incomplete or private, especially `_request`. → Mitigation: Isolate OneBot internal access behind a small local helper in `plugins/onebot-utils/src/index.ts` and test behavior with mocked internals.

[Trade-off] A capability registry would be safer but more abstract. → Accepted because first-version requirements are narrow and concrete.

## Migration Plan

1. Extend the core `ChannelAgentContext` type with a readonly `platform` section.
2. Populate `platform.name` and `platform.unsafeBot` in `createChannelContext(session)`.
3. Update existing test fixtures that construct `ChannelAgentContext`.
4. Add coverage that a registered factory can observe `platform.name` and `platform.unsafeBot`.
5. Add `plugins/onebot-utils` using the current plugin package conventions.
6. Migrate the three completed legacy OneBot tools to `AgentTool` definitions.
7. Add unit tests for platform gating, missing OneBot internal errors, and each migrated tool's call shape.
8. Run scoped core and onebot-utils type checks and tests.

Rollback is straightforward: remove the added `platform` field and any tests that depend on it. No storage, database, or runtime migration is required.

## Open Questions

None for the first version. A future change may introduce a safer platform capability registry if multiple adapter-specific plugins need structured, permission-filtered access.
