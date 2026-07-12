# redesign-agent-runtime Brainstorm Capture

> Note: `superpowers:brainstorming` is not available in this Codex environment. The available `brainstorming` skill was used as the process guide, and this file captures the completed design exploration in the skill's natural format: context, alternatives, decision chain, approved design, and remaining open points. No content was written to `docs/superpowers/specs/`.

## Project Context Explored

Athena currently has `packages/agent` built around `ai-sdk`, with `Agent`, `agent-loop`, `AgentSession`, `SessionManager`, `HookRunner`, compaction, retry, and tool state in one package. The current design works, but the runtime boundary is now too broad:

- `HookRunner` is simpler than `pi-coding-agent`'s extension runner, but lifecycle and behavior-changing hooks remain hard to reason about.
- `AgentSession` owns too many concerns: session persistence, compaction triggers, retry, hooks, tool registry, queue display state, provider middleware, and manual export.
- The current session model uses a fixed `SessionEntry` union, which grows whenever a new extension needs persistent data.
- Existing `triggerTurn` behavior is valuable because Athena must record many group-chat events without always triggering a model response.

Reference inputs reviewed or used as design constraints:

- `references/Apeira的设计模式.md`
- `references/Apeira哪些地方值得借鉴.md`
- `references/apeira/docs`
- `packages/agent/src/agent`
- `packages/agent/src/session`

Main external lesson from Apeira: use a small kernel with channel, queue, state, storage, and plugins. Do not copy Apeira's `xsai` runner model or OpenAI Responses-shaped `AgentInput` naming.

No visual companion was used. The decisions were API and boundary decisions, and text plus small interface sketches were clearer than diagrams.

## Scope Assessment

This change is a runtime architecture design change, not an implementation change.

In scope:

- A new runtime package design in `packages/agent-runtime`.
- Package name `@yesimbot/agent-runtime`.
- `ai-sdk` as the model/provider abstraction.
- Typed plugin system replacing public `HookRunner`.
- Typed channel, typed custom message/entry/state/event declaration merging.
- Append-only storage contract.
- Turn lifecycle with `turnId`.
- `append()` without response.
- Compact and audit as plugin-level validation cases.

Out of scope:

- Direct migration of current core usage.
- Koishi integration.
- Branch/fork/rebase sessions.
- Replacing `ai-sdk` with `xsai`.
- Compatibility with existing `packages/agent` JSONL data.
- Creating implementation tasks in this request.

## Approaches Considered

### Approach A: Continue simplifying `packages/agent` in place

Pros:

- Reuses existing tests and production integration.
- Lowest short-term package churn.

Cons:

- Compatibility pressure keeps `AgentSession`, `HookRunner`, compact, retry, and session management coupled.
- Harder to remove names and concepts that are already exposed.

Decision: Rejected for this design. It is useful as a source of lessons, not as the target refactor path.

### Approach B: Adopt Apeira directly

Pros:

- Small runtime kernel.
- Lightweight plugin and declaration merging model.
- Clearer state/storage/channel boundaries.

Cons:

- Apeira's runner and `xsai` model path are weaker for Athena's provider ecosystem than `ai-sdk`.
- Apeira naming such as `AgentInput` is ambiguous for Athena.
- Direct adoption would force a larger migration than needed.

Decision: Rejected as a direct replacement. Borrow the plugin/runtime boundary ideas only.

### Approach C: New `ai-sdk` runtime with Apeira-style plugin boundaries

Pros:

- Preserves `ai-sdk` provider compatibility.
- Allows a smaller, cleaner runtime API.
- Lets compact/session/audit validate the plugin system instead of becoming core features.
- Avoids dragging core/Koishi responsibilities into runtime design.

Cons:

- Temporarily duplicates some behavior from `packages/agent`.
- Requires later integration work before current core can use it.

Decision: Accepted.

## Agreed Design Direction

Create a new runtime package:

```text
packages/agent-runtime
@yesimbot/agent-runtime
```

Runtime kernel:

```text
Agent = Channel + Queue + State + Storage + Plugins + ai-sdk model execution
```

Core must not include:

- Koishi concepts.
- Athena group-chat behavior policy.
- Current core extension service lifecycle.
- Built-in compact semantics.
- Git-like branch/fork/rebase session behavior.
- A separate LLM runner abstraction over `ai-sdk`.

## Decision Chain

### Q1: Keep "record without response" as a core ability?

Decision: Yes.

The new API must support writing messages without triggering a turn. This is central to Athena group-chat behavior, where many platform events are observations, not prompts.

```ts
await agent.append(message);
```

### Q2: Should `append()` go through plugins?

Decision: Yes, but only through a narrow non-model append pipeline.

`append()` must not run model hooks such as system prompt extension, tool extension, tool hooks, or turn finish hooks. It may run append-specific hooks that transform entries, update state, or emit append events.

### Q3: Should persistence use `AgentEntry` plus declaration merging?

Decision: Yes, but avoid `Input` and `Output` naming.

Use:

- `AgentMessage`
- `ModelMessage`
- `AgentEntry`
- `AgentEvent`
- `AgentState`
- `TurnResult`

### Q4: Use `AgentMessage` as the core history unit?

Decision: Yes.

Do not use `AgentItem` or `AgentInput`. Reuse the current `AgentMessage` mental model and align it with `ai-sdk` message shapes.

### Q5: Make compact fully pluginized?

Decision: Yes.

Core should not define `CompactSummaryMessage`. A compact plugin may persist custom compact entries and later convert them into model-visible messages during context construction.

### Q6: Should plugins fully replace `HookRunner`?

Decision: Yes, but not as a flat object with many top-level methods.

Use a stable plugin shell with a hook map:

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

This preserves a stable plugin object while allowing `AgentPluginHooks` to evolve through declaration merging.

### Q7: Can channel replace `runner.on` / `HookRunner.on`?

Decision: Partially.

Typed channels replace observable events and plugin-to-plugin communication. Hooks remain necessary for reducer-style behavior that changes runtime decisions, such as message transforms, tool extension, or tool-call blocking.

### Q8: Use `append / send / run / waitTurn`?

Decision: Yes.

```ts
agent.append(message); // persist without model response
agent.send(message); // fire-and-forget, returns turnId
agent.run(message); // stream helper for one turn
agent.waitTurn(turnId); // returns retained TurnResult
```

### Q9: What happens when waiting for an already completed turn?

Decision: `waitTurn(turnId)` immediately resolves the retained `TurnResult`.

It only rejects for unknown/expired turn ids or when the wait operation itself is aborted.

### Q10: Should session manager be outside core?

Decision: Yes.

Runtime core only depends on a minimal `AgentStorage` contract:

```ts
interface AgentStorage<T = AgentEntry> {
  append(...entries: T[]): Awaitable<void>;
  read(): Awaitable<readonly T[]>;
  clear(): Awaitable<void>;
}
```

Session manager belongs in a plugin or adapter. First version should not implement branch/fork/rebase.

### Q11: Should `LanguageModel` live in state?

Decision: No.

`LanguageModel` is a runtime resource. `AgentState` should remain JSON-serializable by default. A host may store a serializable `modelRef` in custom state if needed.

### Q12: Should `systemPrompt` live in state?

Decision: No.

Use `systemPrompt` as agent config:

```ts
systemPrompt: string | ((ctx) => Awaitable<string>);
```

Plugins append via `extendSystemPrompt`.

### Q13: Reuse `ai-sdk` message shape?

Decision: Yes.

`AgentMessage` should reuse `ai-sdk` role/content/providerOptions shape while putting runtime metadata under `meta`.

### Q14: Custom messages use arbitrary role?

Decision: No.

Custom messages use `role: "custom"` plus `type`. Plugins cannot invent arbitrary top-level roles.

### Q15: Custom message conversion hook name?

Decision: Use `toModelMessages`, not `projectMessage`.

`transformMessages` operates on `AgentMessage[] -> AgentMessage[]`.
`toModelMessages` operates at the conversion boundary `AgentMessage -> ModelMessage[]`.

### Q16: Does `transformMessages` include live turn messages?

Decision: No.

It transforms historical messages only. Current turn messages are appended after historical transformation so compaction and context pruning cannot accidentally remove the trigger message.

### Q17: When does `send()` persist submitted messages?

Decision: Before model call.

Submitted messages are facts that occurred. They remain in storage even if the model fails or the turn is aborted.

### Q18: Persist lifecycle events by default?

Decision: Only abnormal terminal events by default.

Default event persistence is `terminal-errors`: persist `turn.failed` and `turn.aborted`, not `turn.start`, `turn.done`, deltas, or ordinary tool events. Full audit can be enabled by configuration or plugin.

### Q19: Do pure appended messages have `turnId`?

Decision: No.

Only `send/run` submitted, joined, and generated messages carry a `turnId`. Pure `append()` messages are not part of a turn.

### Q20: Busy behavior naming?

Decision:

```ts
type BusyBehavior = "defer" | "join" | "reject";
```

Default is `defer`.

- `defer`: enqueue a new top-level turn.
- `join`: add messages to active turn pending queue.
- `reject`: throw `AgentBusyError`.

### Q21: `join` persistence?

Decision: `join` messages are immediately persisted, assigned the active `turnId`, and drained after the current model/tool step reaches a safe boundary.

### Q22: Tool registration model?

Decision: Support base tools on agent plus dynamic plugin tools.

```ts
createAgent({ tools });
agent.setTools(nextTools);
```

Plugins use `extendTools`. Same-name conflicts throw by default.

### Q23: Tool hook composition?

Decision:

- `beforeToolCall`: block short-circuits; replace updates args and continues; allow does not short-circuit.
- `afterToolCall`: pipeline merge over the current tool result.

### Q24: Plugin error policy?

Decision:

- `init`: fail-closed.
- `beforeToolCall`: fail-closed by default.
- `stop`, `onAppend`, `onTurnFinish`, transforms, extensions, `afterToolCall`, and `toModelMessages`: fail-open with fallback.

### Q25: Optional plugin behavior?

Decision: Non-optional plugin init failure fails agent initialization. A plugin declared with `optional: true` is explicitly disabled on init failure and emits diagnostics.

### Q26: Lazy init?

Decision: Yes.

`init()` is explicit and idempotent. `append/send/run` lazily initialize. `send()` remains synchronous and initializes in the background pump.

### Q27: `waitTurn()` failure semantics?

Decision: `waitTurn()` resolves `TurnResult` for `done`, `failed`, and `aborted`. It rejects only for unknown/expired turn ids or wait cancellation.

### Q28: Should `AgentMessage.meta.id` be required?

Decision: Yes.

`AgentMessage.meta.id` is created by message constructors and treated as required before the runtime accepts a message. `AgentEntry.id` is also required. They have different meanings and are not forced to be equal:

- `AgentEntry.id`: identity of the persisted record.
- `AgentMessage.meta.id`: identity of the semantic message object.

This avoids coupling storage identity to message identity during compaction, replay, or entry migration.

### Q29: When are assistant and tool messages persisted?

Decision: Use step-level append.

When a complete assistant message or tool result is produced, the runtime immediately persists it through the append pipeline with the current `turnId`. Stream deltas are emitted through channel events and are not persisted by default.

Rejected alternatives:

- Append everything only when the turn finishes, because failed turns would lose completed steps.
- Append every stream delta, because storage would become noisy and expensive to replay.

### Q30: Does the first version support parallel tool execution?

Decision: No parallel tool execution in the first version.

The runtime may accept multiple model-emitted tool calls, but it executes them in deterministic order. Parallel tool execution requires a separate future capability because it affects cancellation, partial failure, resource contention, and ordering.

### Q31: Where does retry policy live?

Decision: Outside runtime core.

Core exposes a single turn attempt, error classification, and optional association metadata such as `parentTurnId` or `retryOf`. Retry decisions belong to plugins or host adapters.

### Q32: What is the first observability event taxonomy?

Decision: Define a small stable event set:

- `agent.*`: `agent.init`, `agent.stop`, `agent.error`
- `turn.*`: `turn.queued`, `turn.started`, `turn.step`, `turn.delta`, `turn.done`, `turn.failed`, `turn.aborted`
- `message.*`: `message.appended`
- `tool.*`: `tool.started`, `tool.done`, `tool.failed`, `tool.blocked`
- `plugin.*`: `plugin.error`, `plugin.disabled`

Default persistence still stores only abnormal terminal events: `turn.failed` and `turn.aborted`. Large payloads belong in entries, messages, or tool results rather than runtime events.

### Q33: Should the new runtime support old JSONL/session data?

Decision: No.

The new runtime does not need to read or migrate existing `packages/agent` session data. No compatibility script is required. Old data remains owned by the old runtime until a separate migration need exists.

### Q34: Which plugin should dogfood the plugin system first?

Decision: `compactPlugin` first; `auditPlugin` for development debugging.

`compactPlugin` validates custom entries, message transformation, model conversion, state, and append pipeline. `auditPlugin` validates event subscription and optional diagnostic persistence. HITL is out of scope.

### Q35: What is the minimum hook context shape?

Decision: Use narrow per-hook context, not the full `Agent` object.

Hook contexts expose only stable capabilities needed by that hook:

- read-only runtime id/config summary
- current turn information where relevant
- abort signal where relevant
- typed state manager
- typed channel
- logger/diagnostics
- storage only for hooks that explicitly need storage, such as append or compact-related hooks
- the hook's own input/output payloads

This prevents plugins from bypassing lifecycle controls by calling `send`, `append`, or `setTools` from arbitrary hooks.

## Final Presented Design

The new runtime is a small `ai-sdk`-based package with four public usage modes:

```ts
await agent.append(message);
const turnId = agent.send(message);
const stream = agent.run(message);
const result = await agent.waitTurn(turnId);
```

It keeps provider compatibility by using `ai-sdk` directly, keeps persistence generic through `AgentStorage`, and keeps extension behavior typed through `AgentPlugin`.

Runtime core owns:

- message constructors and metadata
- append pipeline
- turn queue and busy behavior
- model request construction
- tool execution order and hook composition
- event emission
- minimal state manager
- plugin lifecycle orchestration

Runtime core does not own:

- Koishi/core integration
- old session compatibility
- compact policy
- retry policy
- audit persistence policy beyond abnormal terminal events
- HITL
- branch/fork/rebase sessions

## Remaining Open Points

These are deliberately left for implementation planning or future changes:

1. Exact `AgentPluginHooks` TypeScript signatures.
2. Exact `TurnResult` object fields beyond status/error/messages/usage.
3. Exact retention window for completed `TurnResult` values.
4. Whether `auditPlugin` ships in the first implementation or remains a local development helper.
5. Detailed compact policy thresholds and summary message content.
