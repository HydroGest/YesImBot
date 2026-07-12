## Context

YesImBot separates Koishi integration from the generic agent runtime. Koishi plugins register runtime behavior through `ctx.yesimbot.registerAgentPlugin(factory)`, and each factory receives `ChannelAgentContext` with channel metadata plus an optional raw Koishi bot handle. The agent runtime already exposes ordered tool hooks: `beforeToolCall`, `afterToolCall`, and `onTurnFinish`.

The existing plugin-system spec intentionally keeps core internal `tool.*` events small. They carry stable metadata such as tool name and `turnId`, not full arguments or results. That boundary makes hook-based observation the correct integration point for detailed tool payloads and optional result rewriting.

## Goals / Non-Goals

**Goals:**

- Add an optional Koishi plugin that sends one chat message immediately after each visible tool call completes or fails.
- Include tool name, status, elapsed time, redacted argument overview, and redacted result overview.
- Format JSON-like previews with TOON for compact chat display.
- Provide opt-in model-visible compression that rewrites JSON-like successful tool results into TOON strings.
- Preserve default agent behavior when model-visible compression is disabled.
- Keep the implementation local to the plugin except for any narrow runtime fix required for failed `afterToolCall` observability.

**Non-Goals:**

- Do not add large args/results payloads to runtime internal events.
- Do not expose Koishi `Session`, Koishi `Context`, or direct runtime handles to external plugins.
- Do not build a dashboard, persistent audit log, approval flow, or human-in-the-loop system.
- Do not make TOON compression the default model-visible behavior.
- Do not introduce a broad shared serialization library unless the plugin proves a second caller needs it.

## Decisions

### D1: Implement as an optional external Koishi plugin

- **Choice:** Add a package such as `plugins/tool-observer` that registers an `AgentPlugin` through `ctx.yesimbot.registerAgentPlugin()`.
- **Rationale:** This fits the current extension architecture and keeps `koishi-plugin-yesimbot` core slim.
- **Alternatives considered:** Core-owned visualization was rejected because it would force debugging behavior into the main service. Runtime internal event expansion was rejected because it conflicts with the existing small-event taxonomy and does not support result rewriting.

### D2: Send notifications from `afterToolCall`

- **Choice:** Build and send each notification in `afterToolCall` rather than waiting for `onTurnFinish`.
- **Rationale:** The user explicitly wants one message after each tool call. `afterToolCall` is the first hook with both final arguments and the result context.
- **Alternatives considered:** `onTurnFinish` aggregation was rejected because it delays visibility and hides long-running tool progress.

### D3: Keep display formatting and model-visible result compression separate

- **Choice:** Always use TOON for configured chat previews, but only rewrite tool results when `compressJsonToolResults` is enabled.
- **Rationale:** Chat formatting is observational. Result rewriting changes model input and can affect reasoning, so it must be explicit.
- **Alternatives considered:** Enabling compression by default was rejected because some tools and models may rely on structured JSON results.

### D4: Compress only JSON-like values for model-visible results

- **Choice:** Treat arrays, plain objects, numbers, booleans, and null as JSON-like. Leave strings and non-plain objects unchanged for model-visible compression.
- **Rationale:** The target is large structured tool output. Arbitrary string compression can degrade readable tool output, and complex object serialization can be surprising.
- **Alternatives considered:** Compressing every result was rejected as too broad and behavior-changing.

### D5: Redact before rendering or compression

- **Choice:** Apply key-based redaction before building chat previews and before opt-in compressed result replacement.
- **Rationale:** Tool args/results may contain credentials or private data. Redaction must happen before user-visible output and before any transformed value is returned to the model.
- **Alternatives considered:** Redacting only chat previews was rejected because opt-in compressed results can still preserve sensitive values in the model context.

### D6: Exclude terminal/internal tools by default

- **Choice:** Default `ignoredTools` should include `finalize_response`.
- **Rationale:** Terminal tools are implementation details and would produce noisy notifications.
- **Alternatives considered:** Showing all tools by default was rejected because it makes ordinary turns noisier without improving user understanding.

### D7: Make failed tool calls visible through the same hook contract

- **Choice:** Ensure failed tool executions call `afterToolCall` with `isError: true` and a diagnostic-like result before the runtime reports the tool failure.
- **Rationale:** The observer should not need a separate payload-heavy event path for failures. Existing tests already express this behavior as intended.
- **Alternatives considered:** Listening only to `tool.failed` was rejected because internal events intentionally do not contain args/results and cannot support the required notification detail.

## Risks / Trade-offs

- [Risk] Koishi proactive send APIs can differ by adapter or channel type. → Mitigation: keep sending behind a small plugin-local helper and cover group/private behavior with unit tests around the generic bot API shape used by Koishi.
- [Risk] Tool notifications can leak secrets. → Mitigation: redact configurable key names before rendering or result compression, with conservative defaults such as `apiKey`, `authorization`, `password`, `secret`, and `token`.
- [Risk] Immediate notifications can create chat noise during multi-tool turns. → Mitigation: support `ignoredTools`, preview length limits, and a plugin-level enable flag.
- [Risk] Opt-in TOON result compression can change model behavior. → Mitigation: disable by default, document the trade-off, and apply only to JSON-like successful results.
- [Risk] TOON conversion may fail on unsupported values. → Mitigation: fall back to a bounded safe string preview for display and leave model-visible result unchanged when compression cannot be safely produced.

## Migration Plan

1. Add or fix runtime tests proving failed tool executions reach `afterToolCall` with `isError: true`.
2. Add the optional tool observer plugin package without enabling it in core by default.
3. Add plugin tests for registration, immediate notification formatting, ignored tools, redaction, display truncation, and opt-in TOON result replacement.
4. Document the plugin configuration and the behavior-changing nature of `compressJsonToolResults`.
5. Rollback strategy: disable or uninstall the optional plugin. If the runtime failure-hook fix causes regressions, revert that narrow runtime change independently.

## Open Questions

- None requiring user decision before implementation. The exact Koishi bot send method should be confirmed against Koishi types and tests during implementation.
