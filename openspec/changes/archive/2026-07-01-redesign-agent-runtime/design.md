## Context

Athena needs a runtime that can eventually serve a long-lived group-chat agent, but the runtime itself should not contain group-chat, Koishi, or core-specific responsibilities. Current `packages/agent` has useful pieces: `ai-sdk` integration, `AgentMessage`, tool execution, stream events, custom messages, and manual `triggerTurn`-style behavior. Its main problem is boundary growth around `AgentSession`, `HookRunner`, and `SessionManager`.

Apeira provides useful design patterns: small core, typed channel, append-only storage, plugin lifecycle, state manager, and turn queue. The new runtime should borrow those patterns, but not Apeira's `xsai` runner, `AgentInput` naming, or OpenAI Responses-shaped item model.

Stakeholders:

- Runtime authors need a small, testable package.
- Plugin authors need stable typed extension points.
- Future Athena core integration needs a way to append observed events without triggering replies.
- Provider adapters need to keep using `ai-sdk` rather than a custom runner abstraction.

## Goals / Non-Goals

**Goals:**

- Design a new agent-runtime package in `packages/agent-runtime`.
- Keep `ai-sdk` as the model/provider abstraction.
- Replace public `HookRunner` with a typed plugin system.
- Provide append-only storage through a minimal `AgentStorage` contract.
- Support `append()` as a first-class non-response operation.
- Provide turn lifecycle with stable `turnId`, stream events, and retained `TurnResult`.
- Keep compact and session manager outside runtime core as plugins/adapters.
- Use declaration merging for custom messages, entries, state, and events.

**Non-Goals:**

- Do not migrate existing `core` or `packages/agent` usage in this change.
- Do not introduce `xsai`.
- Do not design Koishi-specific APIs.
- Do not include branch/fork/rebase session behavior in first design.
- Do not create implementation tasks in this request.
- Do not preserve `HookRunner` as a public extension API.

## Decisions

### D1: Build a new package instead of refactoring `packages/agent` in place

- **选择**：Design a new package at `packages/agent-runtime`, published as `@yesimbot/agent-runtime`.
- **理由**：The existing package carries historical responsibilities. A new package allows a cleaner API and avoids forcing current core compatibility into the design.
- **已考慮 alternative**：Refactor `packages/agent` directly. Rejected because compatibility pressure would preserve too many old boundaries.

### D2: Keep `ai-sdk`, do not introduce a runner abstraction

- **选择**：Runtime model execution uses `ai-sdk` `LanguageModel` and `streamText`.
- **理由**：`ai-sdk` already abstracts provider differences and is stronger for Athena's provider ecosystem than Apeira's `xsai` path.
- **已考慮 alternative**：Adopt Apeira-style `Runner`. Rejected for now because it duplicates `ai-sdk`'s abstraction and increases migration cost.

### D3: Use `AgentMessage`, not `AgentInput` or `AgentItem`

- **选择**：Core history unit is `AgentMessage`.
- **理由**：`Input` is ambiguous. In Apeira it means runner-consumable historical item, not user input. Athena already uses message-centered types and `ai-sdk` is message-centered.
- **已考慮 alternative**：Use Apeira `AgentInput`. Rejected because it imports OpenAI Responses semantics and confusing terminology.

### D4: Put runtime metadata in `meta`

- **选择**：`AgentMessage` reuses `ai-sdk` message shape and adds runtime metadata under `meta`. Message constructors create `AgentMessage.meta.id`, and the runtime accepts already constructed `AgentMessage` values.
- **理由**：Avoids collisions with provider fields and keeps conversion to `ModelMessage` clear.
- **已考慮 alternative**：Top-level `timestamp`, `usage`, `turnId`, etc. Rejected because metadata spreads across message shapes. Keeping `meta.id` optional was also rejected because events, UI, and tool results need a stable semantic message identity.

Example:

```ts
interface AgentMessageMeta {
  id: string;
  turnId?: string;
  timestamp: number;
  source?: string;
  visible?: boolean;
  details?: unknown;
}
```

`AgentEntry.id` and `AgentMessage.meta.id` are both required but have different meanings. `AgentEntry.id` identifies the persisted record. `AgentMessage.meta.id` identifies the semantic message object. The runtime does not require them to be equal.

### D5: Custom messages use `role: 'custom' + type`

- **选择**：Plugins extend custom messages through declaration merging, but all custom messages use `role: 'custom'` and a specific `type`.
- **理由**：`role` has strong LLM semantics. Arbitrary roles would pollute the model conversion boundary.
- **已考慮 alternative**：Allow plugin-defined roles. Rejected because it weakens exhaustiveness and conversion safety.

### D6: Split context transformation and model conversion

- **选择**：
  - `transformMessages`: `AgentMessage[] -> AgentMessage[]`, for historical context shaping.
  - `toModelMessages`: `AgentMessage -> ModelMessage[]`, for custom message conversion.
- **理由**：They operate at different layers. One constructs context; the other converts to `ai-sdk` messages.
- **已考慮 alternative**：Single conversion/transform hook. Rejected because it mixes pruning, insertion, and model serialization.

`transformMessages` handles history only. Current turn messages are appended after transformation so they cannot be removed by compaction or pruning.

### D7: Make `append()` first-class

- **选择**：Expose `append(message)` to persist messages without triggering a turn.
- **理由**：Athena must observe and record group-chat events without always replying.
- **已考慮 alternative**：Use `send()` with flags or plugins to cancel response. Rejected because it makes observation a side effect of model execution.

`append()` runs a narrow append pipeline, not model hooks.

### D8: Use `append / send / run / waitTurn`

- **选择**：

```ts
agent.append(message);
agent.send(message);
agent.run(message);
agent.waitTurn(turnId);
```

- **理由**：Separates persistence, fire-and-forget execution, stream consumption, and turn settlement.
- **已考慮 alternative**：Overloaded `prompt()`. Rejected because it hides too many modes.

### D9: Persist submitted messages before model call

- **选择**：`send()` writes submitted messages before the model request.
- **理由**：The user/platform event already happened. Failure or abort should not erase that fact.
- **已考慮 alternative**：Append submitted and generated messages only after success. Rejected because it loses failed-turn context.

### D10: Default event persistence is abnormal terminal events only

- **选择**：Default `eventPersistence` is `terminal-errors`, persisting `turn.failed` and `turn.aborted`.
- **理由**：Keeps storage useful without adding ordinary lifecycle noise. Full audit belongs in configuration or plugin.
- **已考慮 alternative**：Persist every lifecycle event. Rejected for storage noise and unnecessary context filtering burden.

### D11: Busy behavior uses `ifBusy`

- **选择**：

```ts
type BusyBehavior = "defer" | "join" | "reject";
```

Default is `defer`.

- **理由**：It replaces `steer/followUp` with general runtime terms.
- **已考慮 alternative**：Apeira single active-turn queue behavior. Rejected because Athena needs both "join current turn" and "defer to next turn".

`join` messages are immediately persisted, assigned active `turnId`, and drained after the current safe step.

### D12: Model and system prompt are runtime resources, not built-in state

- **选择**：
  - `LanguageModel` is agent runtime resource.
  - `systemPrompt` is config string or function.
  - State remains JSON-serializable by default.
- **理由**：`LanguageModel` cannot be serialized and prompt is a runtime construction result.
- **已考慮 alternative**：Store `model` and `systemPrompt` in `AgentState`. Rejected because it mixes runtime objects with persistent state.

### D13: Plugin shell plus hook map

- **选择**：

```ts
interface AgentPlugin {
  name: string;
  version?: string;
  enforce?: "pre" | "post";
  init?(agent: Agent): Awaitable<void>;
  stop?(): Awaitable<void>;
  hooks?: Partial<AgentPluginHooks>;
}
```

- **理由**：The plugin object stays stable while `AgentPluginHooks` can evolve through declaration merging.
- **已考慮 alternative**：Flat plugin methods. Rejected because top-level interface changes would break every plugin more often.

### D14: Channels are for events, hooks are for behavior changes

- **选择**：Typed channels handle observation and plugin communication. Hooks handle reducer/pipeline behavior.
- **理由**：Channels cannot safely replace ordered hooks that return values.
- **已考慮 alternative**：Only channel events. Rejected for transform/tool decision use cases.

### D15: Plugin error policies are explicit by hook category

- **选择**：
  - `init`: fail-closed.
  - `beforeToolCall`: fail-closed by default.
  - `stop`, `onAppend`, `onTurnFinish`, transforms, extensions, `afterToolCall`, `toModelMessages`: fail-open with fallback.
  - `optional: true` provides explicit init downgrade.
- **理由**：Safety-critical hooks must not silently fail open, while observation/transform hooks should not break normal operation.
- **已考慮 alternative**：All fail-open like current `HookRunner`. Rejected for tool safety.

### D16: Tool registration supports base tools plus plugin tools

- **选择**：`createAgent({ tools })` and `agent.setTools()` define base tools; plugins add tools through `extendTools`.
- **理由**：Simple callers should not need a plugin for basic tools, but dynamic integrations belong in plugins.
- **已考慮 alternative**：Only plugins provide tools. Rejected for testing and simple usage ergonomics.

Same-name conflicts throw by default.

### D17: Tool execution is deterministic and serial in the first version

- **选择**：The runtime may accept multiple model-emitted tool calls, but executes them in deterministic order in the first version.
- **理由**：This stays compatible with modern model output while avoiding parallel cancellation, partial failure merging, resource contention, and ordering complexity in the initial runtime.
- **已考慮 alternative**：Support only one tool call. Rejected because it conflicts with common model behavior. Parallel tool execution was rejected for the first version and should be introduced as a separate future capability.

### D18: Storage core is minimal; sessions are external

- **选择**：

```ts
interface AgentStorage<T = AgentEntry> {
  append(...entries: T[]): Awaitable<void>;
  read(): Awaitable<readonly T[]>;
  clear(): Awaitable<void>;
}
```

- **理由**：Runtime only needs append/read/clear. Session policy is a storage adapter/plugin concern.
- **已考慮 alternative**：Include session manager in core. Rejected because it recreates current coupling.

### D19: Compact is a plugin, not a core feature

- **选择**：Core does not define `CompactSummaryMessage`.
- **理由**：Compact has persistence, context transform, and model projection semantics that should be owned by a plugin.
- **已考慮 alternative**：Keep simple compact in core. Rejected because it would be the first special case in a new generic runtime.

### D20: Assistant and tool outputs are persisted at step boundaries

- **选择**：Complete assistant messages and tool results are persisted immediately after each step completes, through the append pipeline, with the current `turnId`.
- **理由**：A failed turn should not lose already completed outputs or tool results.
- **已考慮 alternative**：Persist only when the turn finishes. Rejected because it loses partial progress on failure. Persist every stream delta. Rejected because it creates noisy, expensive history.

Stream deltas are emitted through channel events and are not persisted by default.

### D21: Retry policy belongs outside runtime core

- **选择**：Runtime core exposes single turn attempts, error classification, and optional association metadata such as `parentTurnId` or `retryOf`. Retry decisions belong to plugins or host adapters.
- **理由**：Provider errors, tool errors, safety blocks, user cancellation, and platform timing all require different retry policies.
- **已考慮 alternative**：A fixed core retry count or generic retry config. Rejected because both pull policy and scheduling complexity back into core.

### D22: Observability starts with a small stable event taxonomy

- **选择**：Core event names are grouped under `agent.*`, `turn.*`, `message.*`, `tool.*`, and `plugin.*`.
- **理由**：A small event taxonomy is easier to test and document, while typed declaration merging still allows plugin events.
- **已考慮 alternative**：Forward provider-specific events directly. Rejected because it would expose unstable high-cardinality internals.

Initial core events:

- `agent.init`, `agent.stop`, `agent.error`
- `turn.queued`, `turn.started`, `turn.step`, `turn.delta`, `turn.done`, `turn.failed`, `turn.aborted`
- `message.appended`
- `tool.started`, `tool.done`, `tool.failed`, `tool.blocked`
- `plugin.error`, `plugin.disabled`

Default persistence remains abnormal terminal events only: `turn.failed` and `turn.aborted`.

### D23: No old JSONL compatibility in the new runtime

- **选择**：The new runtime does not read or migrate existing `packages/agent` session data, and no conversion script is required in this change.
- **理由**：The new runtime is a clean target design. Old data remains owned by the old runtime until a concrete migration need appears.
- **已考慮 alternative**：Offline migrator or transparent compatibility adapter. Rejected because compatibility is not needed for the current goal and would expand scope.

### D24: Dogfood plugins are compact first and audit for debugging

- **选择**：Build `compactPlugin` first when implementation begins; use `auditPlugin` for development debugging. HITL is out of scope.
- **理由**：Compact validates custom entries, transforms, model conversion, state, and append pipeline. Audit validates channel subscription and optional diagnostic persistence.
- **已考慮 alternative**：Start with session or HITL plugins. Rejected because session is host-policy dependent and HITL has no current requirement.

### D25: Hook contexts are narrow and per-hook

- **选择**：Hook contexts expose only stable capabilities needed by that hook, not the full `Agent` object.
- **理由**：Plugins should not bypass lifecycle controls by calling `send`, `append`, or `setTools` from arbitrary hooks.
- **已考慮 alternative**：Pass full `Agent` to every hook. Rejected because it creates reentrancy and dependency risks.

Typical hook context capabilities:

- read-only runtime id/config summary
- current turn information where relevant
- abort signal where relevant
- typed state manager
- typed channel
- logger/diagnostics
- storage only for hooks that explicitly need storage
- hook-specific input/output payloads

## Risks / Trade-offs

[Risk] New package may duplicate some code from `packages/agent` temporarily. Mitigation: keep it explicitly experimental until migration is planned.

[Risk] Plugin hook map can still become too broad. Mitigation: require each new hook to define composition and error policy before adding it.

[Risk] `append()` plus `send()` persistence could produce histories with user messages and failed turns. Mitigation: this is a truthful history; abnormal terminal events are persisted by default.

[Risk] Without built-in compact, first runtime version may lack long-session protection. Mitigation: compact plugin should be one of the first dogfood plugins, but outside core.

[Risk] `join` semantics can surprise callers if overused. Mitigation: default `ifBusy` is `defer`, and `join` is explicit.

[Risk] Step-level append can leave partial assistant/tool history after failed turns. Mitigation: this is intentional truthful history; `TurnResult` and abnormal terminal event entries record the failed status.

[Risk] Serial tool execution may be slower for independent tools. Mitigation: deterministic serial execution is the first-version behavior; parallel execution requires a future explicit capability.

[Trade-off] Avoiding a runner abstraction keeps `ai-sdk` integration direct but makes model execution part of runtime core. This is accepted because `ai-sdk` is already the provider abstraction Athena wants.

## Migration Plan

1. Create the new package as experimental, without changing existing `packages/agent` or core usage.
2. Implement type surface and unit tests first: message, entry, channel, plugin runner, storage, queue.
3. Implement ai-sdk model execution and tool hooks.
4. Implement minimal memory/jsonl storage adapters for the new entry format only.
5. Build compact as the first dogfood plugin to validate the plugin/storage design.
6. Add audit as a development/debug plugin if event diagnostics need persistent traces.
7. Rollback strategy: keep existing `packages/agent` as the production runtime until new runtime passes parity tests.

## Open Questions

1. Exact `AgentPluginHooks` TypeScript signatures.
2. Exact `TurnResult` fields beyond status, error, messages, and usage.
3. Exact retention window for completed `TurnResult` values.
4. Whether `auditPlugin` ships in the first implementation or remains a local development helper.
5. Detailed compact policy thresholds and summary message content.
