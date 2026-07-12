<!--
Raw capture of superpowers:brainstorming output.

本檔原樣捕捉 brainstorming skill 的產出，不強制結構。
Skill 的自然產出通常是 decision log 格式（背景 → 決議鏈 Q1-Qn → 設計取捨），
但依對話內容可能有不同組織方式。

design.md 從本檔萃取並重新整理為結構化設計文件。

不要將本檔的內容複製到 design.md — design.md 是獨立的重組產物，
兩者互補但不重疊。
-->

# Brainstorm: Tool Call Observer Plugin

## Project Context

Athena / YesImBot uses `koishi-plugin-yesimbot` as the Koishi integration layer and `@yesimbot/agent-runtime` as the message-first runtime. Optional Koishi plugins register runtime behavior through `ctx.yesimbot.registerAgentPlugin(factory)`.

Relevant existing boundaries:

- `AgentPlugin` already has `beforeToolCall`, `afterToolCall`, and `onTurnFinish` hooks.
- Core calls external plugin factories with `ChannelAgentContext`, including channel metadata and `platform.unsafeBot` when available.
- The runtime's internal `tool.*` events intentionally carry small stable metadata and do not embed large args/results payloads.
- Core should not expose runtime handles or Koishi `Session` to external plugins.

This points toward an optional Koishi plugin that registers an `AgentPlugin` rather than a core runtime change for the user-facing notification behavior.

## Decision Chain

### Q1: Should notifications be per turn or per tool call?

Decision: Send one chat message immediately after each tool call completes.

Reasoning: The user's goal is real-time visibility into what the agent is doing. Waiting until `onTurnFinish` would hide long-running tool activity and make debugging harder.

Implication: The notification path should run from `afterToolCall`, not only from `onTurnFinish`.

### Q2: Should TOON only be a display format?

Decision: No. TOON has two separate uses:

- Display compression for chat-visible args/results overviews.
- Optional model-visible compression by replacing JSON-like tool results with TOON strings.

Reasoning: Display compression improves readability. Model-visible compression can reduce token usage, but it changes what the model sees and therefore must be opt-in.

### Q3: Should model-visible TOON compression be enabled by default?

Decision: No. It must be disabled by default and enabled through configuration.

Reasoning: Rewriting tool results is behavior-changing. Some tools or models may rely on structured JSON results. Default behavior should observe and display without changing agent semantics.

### Q4: What should be compressed?

Decision: Compress only JSON-like values by default: plain objects, arrays, numbers, booleans, and null. Leave strings and non-JSON-like values unchanged for model-visible compression.

Reasoning: Tool JSON results are the target for token reduction. Compressing arbitrary strings can make natural-language tool output worse, and serializing complex objects risks surprising behavior.

### Q5: How should failures be handled?

Decision: Failed tool calls should produce immediate notifications when the runtime can expose failure details to `afterToolCall`.

Reasoning: Failures are often the most important calls to surface. Exploration found a possible mismatch: current tests expect failed tool calls to reach `afterToolCall`, while the visible runtime catch path appears to emit `tool.failed` and rethrow. The proposal should include a requirement to make failed tool calls observable through the same hook path before or as part of plugin implementation.

## Approaches Considered

### Approach A: External observer plugin only

Create `plugins/tool-observer` as an optional Koishi plugin. It registers an `AgentPlugin` that captures timing in `beforeToolCall`, sends chat notifications in `afterToolCall`, and optionally returns a patched TOON result from `afterToolCall`.

Pros:

- Fits current plugin architecture.
- Keeps core runtime and core Koishi service small.
- Display and result compression are local to one optional plugin.

Cons:

- Depends on `ChannelAgentContext.platform.unsafeBot` for proactive chat sends.
- May require a small runtime fix if failed tool calls do not currently reach `afterToolCall`.

### Approach B: Extend runtime internal events with args/results

Emit args/results on `tool.done` / `tool.failed`, then let core or a plugin subscribe and render.

Pros:

- A channel subscriber could observe tool calls without changing hook behavior.

Cons:

- Conflicts with the existing spec that internal events should carry only small stable fields and not large payloads.
- Would duplicate hook payloads into the event taxonomy.
- Does not naturally support optional model-visible result rewriting.

### Approach C: Core-owned tool visualization

Add notification behavior directly to `koishi-plugin-yesimbot` core.

Pros:

- Core has direct access to sessions and reply rendering paths.

Cons:

- Makes core less slim.
- Forces all deployments to carry debugging/observability behavior.
- Still does not solve optional result rewriting as cleanly as an `afterToolCall` hook.

Recommendation: Approach A.

## Proposed Feature Shape

```
tool call starts
  -> beforeToolCall records start time and sanitized args snapshot

tool call completes or fails
  -> afterToolCall builds chat notification immediately
  -> notification uses TOON for JSON-like args/results overview
  -> plugin sends message to current Koishi channel through the captured bot handle
  -> if configured and result is JSON-like, plugin returns a patched TOON string result
```

## Configuration Ideas

- `enabled`: default true.
- `displayArgs`: default true.
- `displayResult`: default true.
- `displayMaxChars`: default 1200.
- `ignoredTools`: default includes `finalize_response`.
- `redactKeys`: default includes `apiKey`, `authorization`, `password`, `secret`, and `token`.
- `compressJsonToolResults`: default false.
- `compressedResultMaxChars`: default 8000.
- `sendTimeoutMs`: optional timeout for proactive chat sends.

## Risks And Constraints

- Proactive send must use Koishi's generic bot API in a way that works for group and private channel scopes.
- The plugin must avoid leaking secrets in args/results previews.
- If model-visible compression is enabled, downstream reasoning may change because tool results become TOON strings instead of structured JSON values.
- The plugin should avoid recursive or noisy notifications for terminal/internal tools such as `finalize_response`.
- Failed tool calls need consistent hook visibility before notifications can include failure result details.

## Approved Direction

Build a focused optional tool observer plugin using existing runtime hooks. It should immediately notify chat after each visible tool call and optionally compress JSON-like tool results into TOON for the model. Keep the default behavior observational and non-semantic-changing; make model-visible TOON compression opt-in.
