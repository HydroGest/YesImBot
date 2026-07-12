## Context

Athena is moving from a heavy historical `core` design toward a thinner Koishi host adapter built on `@yesimbot/agent-runtime`. The runtime package already owns the generic agent loop, message model, turn queue, plugin hooks, tool execution, state, and storage contracts. The new `core` should not recreate those responsibilities.

The current `core/src/index.ts` prototype proves the basic integration path, but it mixes Koishi lifecycle, model resolution, runtime caching, prompt file reading, channel message conversion, trigger policy, result rendering, and error handling in one place. This change should turn that prototype into a small, stable first version with clear boundaries.

Stakeholders:

- Core maintainers need a simple Koishi integration layer that can evolve without reviving the old core architecture.
- Runtime maintainers need a few generic semantics that support group chat, especially interrupt and active-turn observation visibility.
- Koishi extension authors need a practical way to register runtime plugins while still accessing Koishi APIs through normal Koishi plugin lifecycles.
- Future plugin authors need channel-isolated runtime plugin instances rather than global singletons.

Primary constraints:

- Keep the first version minimal.
- Prefer direct, local changes over broad abstractions.
- Preserve append-only history ordering.
- Do not migrate legacy plugins or old session data.
- Use English-only OpenSpec artifacts for this change.

## Goals / Non-Goals

**Goals:**

- Reimplement `koishi-plugin-yesimbot` core on top of `@yesimbot/agent-runtime`.
- Provide `ctx.yesimbot` as the main core service.
- Keep `ctx["yesimbot.model"]` as the model registry service.
- Create one runtime per `platform + selfId + channelId`.
- Convert Koishi non-self messages into a stable channel custom message.
- Append ordinary group messages without triggering a reply.
- Send direct messages and bot mentions, then render all non-empty assistant text replies.
- Preserve Koishi `session.content` exactly, including Koishi message element strings.
- Read `AGENTS.md` and optional `PERSONA.md` from the unified `basePath`.
- Inject core/channel context through `systemPrompt`, then inject `AGENTS.md` and `PERSONA.md` as system messages through `transformMessages()`.
- Support external Koishi plugins through `ctx.yesimbot.registerAgentPlugin(factory)`.
- Use one append-only JSONL file per channel runtime.
- Provide current-channel reset through interrupt, stop, storage clear, and runtime cache removal.
- Add runtime `interrupt()` support needed by reset and lifecycle handling.
- Make active-turn `append()` observations visible at the next safe model boundary without turning them into explicit joined user input.

**Non-Goals:**

- Restore the legacy core extension system.
- Migrate legacy plugins.
- Parse images, files, audio, or other multimodal Koishi elements.
- Add a complex response-willingness model.
- Add a separate prompt preamble API.
- Add `developer` role support.
- Add model hot switching, fallback models, retry models, or per-channel model configuration.
- Enable compact by default.
- Add long-term memory retrieval.
- Migrate old `packages/agent` session data.
- Expose runtime handles or direct `send()` / `append()` operations through `ctx.yesimbot`.
- Dynamically reload already-created channel runtimes when plugins register or unregister.
- Add JSONL indexes, pagination, schema migration, or compression.

## Decisions

### D1: Keep core as a Koishi host adapter over agent-runtime

- **Choice**: `core` owns Koishi lifecycle, model resolution, channel runtime management, platform message conversion, reply rendering, prompt file loading, JSONL storage selection, and reset commands. `agent-runtime` owns turns, hooks, tools, storage contracts, and model execution.
- **Rationale**: This keeps `core` focused on platform adaptation and prevents it from rebuilding a second agent orchestration layer.
- **Alternatives considered**: Recreate the old core architecture with extension lifecycle, session manager, and agent loop behavior. Rejected because it would repeat the coupling this redesign is meant to remove.

### D2: Use normal Koishi plugins plus `registerAgentPlugin(factory)` instead of a new CoreExtension lifecycle

- **Choice**: External extensions remain ordinary Koishi plugins. They register per-channel runtime plugin factories through `ctx.yesimbot.registerAgentPlugin(factory)`.
- **Rationale**: Koishi already manages global plugin lifecycle. A separate `CoreExtension.setup()` would duplicate Koishi and add unnecessary ceremony.
- **Alternatives considered**: A heavy `RuntimeContribution` object or a separate core extension lifecycle. Rejected as too broad for the first version.

### D3: Require per-channel AgentPlugin factories, not global AgentPlugin singletons

- **Choice**: `registerAgentPlugin()` accepts a factory returning exactly one `AgentPlugin`.
- **Rationale**: Runtime plugins may capture channel-specific capabilities, logger context, and tool closures. Per-channel instances avoid cross-channel state leaks.
- **Alternatives considered**: Registering plugin singletons, or factories returning arrays. Rejected because singletons are unsafe and arrays can be represented by multiple registration calls.

### D4: Keep ChannelAgentContext narrow

- **Choice**: `ChannelAgentContext` contains only channel metadata and a logger.
- **Rationale**: Koishi plugins can capture `ctx` and their own services in closures. `core` should not pass the full Koishi `Context` to every runtime factory by default.
- **Alternatives considered**: Pass full Koishi `Context`, current `Session`, or a broad platform API. Rejected because those widen coupling and confuse per-channel lifecycle with per-message lifecycle.

### D5: Isolate runtimes by platform, selfId, and channelId

- **Choice**: The runtime key is `platform + selfId + channelId`; channel type is metadata only.
- **Rationale**: This isolates bot identities and channel histories while preserving group-channel context as one shared conversation.
- **Alternatives considered**: Key by user or channel type. Rejected because group chat should not split by user, and channel type does not identify a unique conversation.

### D6: Preserve Koishi content strings exactly

- **Choice**: `session.content` is stored and converted as-is, including `<at/>` and other Koishi message elements.
- **Rationale**: Koishi content is the platform's message element representation and future formats can use the same carrier.
- **Alternatives considered**: Strip bot mentions or parse only plain text. Rejected because it loses platform-level information and makes future element support harder.

### D7: Treat assistant output as text for the first version

- **Choice**: Send every non-empty assistant text message from the turn result, in order.
- **Rationale**: This is simple, predictable, and enough for the first usable Koishi integration.
- **Alternatives considered**: Let the model produce Koishi elements directly. Rejected for the first version because it needs a stronger rendering and safety boundary.

### D8: Distinguish observation append from joined explicit input

- **Choice**: Ordinary group messages use `append()`; direct and mentioned messages use `send()`, with busy mentions/direct messages using join semantics.
- **Rationale**: The agent should observe group changes without treating every group message as a request to respond. Explicit user input should join the active turn when busy.
- **Alternatives considered**: Defer all busy input to later turns, or join all group messages. Rejected because defer creates temporal splits and joining all observations changes reply-triggering semantics.

### D9: Make active-turn append observations visible at safe model boundaries

- **Choice**: During an active turn, appended observations should be available to the current turn at the next safe model boundary while preserving append-only storage order.
- **Rationale**: Group chat agents must stay aware of room changes while thinking or using tools. Waiting until a later top-level turn creates stale behavior and can pressure timestamp-based reordering.
- **Alternatives considered**: Let append affect only future top-level turns. Rejected because it causes temporal discontinuity in group chat.

### D10: Keep prompt block splitting small in the first version

- **Choice**: Use `systemPrompt` for core/channel context, then use `transformMessages()` to inject `AGENTS.md` and `PERSONA.md` as system messages in the order `AGENTS.md` then `PERSONA.md`.
- **Rationale**: This splits stable prompt content into separate message blocks without adding a new runtime prompt preamble API.
- **Alternatives considered**: Concatenate all prompt files into one system string, or introduce `extendModelPreamble`. Concatenation was rejected because it broadens prompt-cache invalidation. A new preamble API was deferred to keep the first version small.

### D11: Accept transform-pipeline prompt injection side effects for now

- **Choice**: The first version accepts that prompt system messages injected through `transformMessages()` can be seen or changed by other message transform plugins.
- **Rationale**: This preserves runtime API simplicity for the first implementation.
- **Alternatives considered**: Isolate prompt messages from all history transforms. Rejected for the first version, but preserved as a future design direction.

### D12: Keep model registry in core

- **Choice**: Provider plugins register models into `ctx["yesimbot.model"]`; `core` resolves `config.chatModel` and passes the resulting `LanguageModel` to `createAgent()`.
- **Rationale**: Model registration is a Koishi integration concern. `agent-runtime` should remain provider-agnostic at the `LanguageModel` boundary.
- **Alternatives considered**: Move model registry into runtime. Rejected because it would couple runtime to Koishi/provider plugin concerns.

### D13: Use per-channel JSONL storage

- **Choice**: Each channel runtime uses one append-only JSONL file under `basePath/sessions/`, named by sanitized `platform-selfId-channelId`.
- **Rationale**: This gives minimal persistent history without a session manager, indexes, migrations, or compaction.
- **Alternatives considered**: Memory-only storage or a full session manager. Memory-only was rejected because reset and restart behavior need a persistent first version. A session manager was rejected as too heavy.

### D14: Implement reset through runtime interrupt

- **Choice**: Add `agent.interrupt(reason?)`, then compose reset as interrupt, stop, clear JSONL, and remove runtime from cache.
- **Rationale**: Reset must be reliable even during active turns. Interrupt belongs in runtime because it owns active turn execution and `waitTurn()` settlement.
- **Alternatives considered**: Reject reset while busy, or force clear without interruption. Rejected because both make reset behavior less reliable.

### D15: Keep configuration minimal

- **Choice**: Preserve only `basePath`, `chatModel`, and `logLevel`.
- **Rationale**: These are enough to locate data, select the model, and control diagnostics.
- **Alternatives considered**: Add debug, storage, model fallback, prompt, or channel policy configuration. Rejected until there is a concrete first-version need.

### D16: Treat channel error replies as development diagnostics

- **Choice**: On direct or mentioned message processing failure, send a generic error message to the current channel. Ordinary append failures only log.
- **Rationale**: Developers need visible feedback while stabilizing the integration, but error replies are not a product feature.
- **Alternatives considered**: Never send errors, or send detailed errors. Rejected because silent failures slow development and detailed channel errors leak internals.

## Risks / Trade-offs

[Risk] Injecting `AGENTS.md` and `PERSONA.md` through `transformMessages()` means compact or compatibility plugins can modify system instruction messages. → Mitigation: document this explicitly and require such plugins to preserve system instructions; consider a future prompt preamble API.

[Risk] Sanitized JSONL filenames can theoretically collide. → Mitigation: accept this first-version risk or add a cheap fallback only if implementation reveals practical collisions.

[Risk] Active-turn append visibility requires runtime changes, not just core integration. → Mitigation: implement and test runtime safe-boundary behavior before relying on it in core message flow.

[Risk] `interrupt()` behavior depends on provider and tool cancellation support. → Mitigation: define interrupt as best-effort cancellation with stable turn settlement and no history rollback.

[Risk] External plugins can capture Koishi `ctx` in factory closures and still create coupling. → Mitigation: keep the official `ChannelAgentContext` narrow and keep runtime behavior changes behind `AgentPlugin`.

[Risk] JSONL storage is simple but not scalable. → Mitigation: explicitly scope out indexes, pagination, and compaction; add richer storage only after core behavior stabilizes.

[Trade-off] Keeping plugin registration from affecting already-created runtimes avoids hot-reload complexity but requires restart for plugin changes. → Accepted because first-version stability matters more than dynamic reload.

[Trade-off] Preserving Koishi content strings makes model input less clean but keeps platform semantics intact. → Accepted because Koishi elements are the canonical platform representation.

## Migration Plan

1. Add the small runtime capabilities required by core: `interrupt()` and safe-boundary visibility for active-turn appended observations.
2. Rework `core` around a `ctx.yesimbot` service and retain `ctx["yesimbot.model"]` for providers.
3. Add per-channel runtime keying and JSONL storage construction under the unified `basePath`.
4. Add built-in runtime plugins for channel message conversion and prompt file injection.
5. Add the `registerAgentPlugin(factory)` API and wire registered factories into newly created channel runtimes.
6. Implement Koishi middleware message routing: ignore self messages, append ordinary group messages, send direct and mentioned messages.
7. Implement assistant text rendering, generic development error replies, reset command, and dispose cleanup.
8. Verify with runtime unit tests and core-scoped tests for routing, storage, prompt ordering, plugin registration, reset, and error behavior.

Rollback strategy:

- Keep the change scoped to the experimental core rewrite path.
- If runtime interrupt or active append semantics fail, revert those runtime changes independently before applying the core rewrite.
- If JSONL storage causes integration issues, fall back to memory storage only as a temporary development fallback, not as the accepted first-version behavior.

## Open Questions

- Should sanitized JSONL filename collisions receive a small deterministic fallback during implementation, or remain documented as an accepted first-version risk?
- What exact administrator authority level should the reset command require?
- What exact generic error text should be sent for direct or mentioned message failures?
