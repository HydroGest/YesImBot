## 1. Runtime Hook Observability

- [x] 1.1 Add a failing-tool regression test proving `afterToolCall` receives `{ isError: true }`, final arguments, tool name, tool call id, and a diagnostic-like error result.
- [x] 1.2 Fix the runtime tool execution path if needed so failed tool executions call `afterToolCall` before the failure is reported back through model tool execution.
- [x] 1.3 Verify `afterToolCall` failures remain fail-open for both successful and failed tool executions.

## 2. Plugin Package Shell

- [x] 2.1 Add the `koishi-plugin-yesimbot-tool-observer` workspace package under `plugins/tool-observer/` following existing plugin package conventions.
- [x] 2.2 Define the Koishi plugin config schema with defaults for enablement, display sections, ignored tools, redaction keys, preview limits, send timeout, and opt-in result compression.
- [x] 2.3 Register one channel-scoped `AgentPlugin` through `ctx.yesimbot.registerAgentPlugin()` and dispose it on plugin stop.

## 3. Formatting And Sanitization

- [x] 3.1 Implement JSON-like value detection for plain JSON-compatible values used by display formatting and optional result compression.
- [x] 3.2 Implement key-based redaction before chat rendering and before opt-in compressed result replacement.
- [x] 3.3 Implement a plugin-local TOON formatter for compact JSON-like previews.
- [x] 3.4 Implement bounded safe previews and truncation indicators for non-JSON-like or oversized values.

## 4. Chat Notification Behavior

- [x] 4.1 Capture per-tool-call start time and final arguments in `beforeToolCall` without changing the tool decision.
- [x] 4.2 Send one chat notification in `afterToolCall` for each non-ignored successful tool call.
- [x] 4.3 Send one chat notification in `afterToolCall` for each non-ignored failed tool call when the runtime exposes the failed result context.
- [x] 4.4 Keep notification send failures logged or reported without failing the active agent turn.

## 5. Optional Model-Visible Compression

- [x] 5.1 When `compressJsonToolResults` is disabled, return no `afterToolCall` result patch.
- [x] 5.2 When enabled, replace JSON-like successful non-ignored tool results with bounded TOON strings.
- [x] 5.3 Leave failed, ignored, non-JSON-like, or unsafe-to-compress results unchanged.

## 6. Tests And Documentation

- [x] 6.1 Add plugin tests for registration/disposal, ignored tools, default terminal tool filtering, immediate notification content, redaction, truncation, and send failure handling.
- [x] 6.2 Add plugin tests for opt-in result compression and default non-rewriting behavior.
- [x] 6.3 Add package-scoped type checks and tests to the verification path.
- [x] 6.4 Document plugin configuration and clearly mark `compressJsonToolResults` as behavior-changing and disabled by default.
