## Why

YesImBot can run tools during long or complex turns, but users currently only see the final assistant reply. This makes tool behavior hard to inspect in chat and hides failures until the turn settles. A focused optional plugin should make tool execution visible immediately and, when explicitly enabled, reduce model-visible JSON tool result size with TOON compression.

## What Changes

**Tool call chat visibility**
- From: Tool calls are observable through runtime internals and hooks, but no optional Koishi plugin sends human-readable tool call summaries to the chat.
- To: Add an optional tool observer plugin that sends one chat message immediately after each non-ignored tool call completes or fails.
- Reason: Users need real-time visibility into tool name, arguments, result overview, status, and latency.
- Impact: Non-breaking. Deployments opt in by enabling the plugin.

**TOON display formatting**
- From: JSON-like args and results have no compact chat display format.
- To: Render JSON-like argument and result overviews in TOON format for tool notification messages.
- Reason: TOON is more compact and readable than pretty JSON in chat windows.
- Impact: Non-breaking. This affects only plugin-generated notification text.

**Optional model-visible TOON result compression**
- From: Tool results are passed back to the model in their original runtime value unless another plugin rewrites them.
- To: When configured, the tool observer plugin rewrites JSON-like tool results into TOON strings through `afterToolCall`.
- Reason: Large JSON tool outputs can consume significant context tokens.
- Impact: Behavior-changing but opt-in. Disabled by default.

**Failed tool hook observability**
- From: The runtime has tests expecting failed tool calls to reach `afterToolCall`, but the implementation path must be verified and made consistent.
- To: Failed tool calls must be observable through `afterToolCall` with `isError: true` so the observer can notify failures through the same path as successes.
- Reason: Failures are important user-visible tool events and should not require a separate payload-heavy internal event channel.
- Impact: Runtime plugin contract clarification and possible bug fix.

## Capabilities

### New Capabilities
- `tool-call-observer`: Optional Koishi plugin capability for immediate tool call chat notifications, TOON display formatting, redaction, filtering, and opt-in model-visible TOON result compression.

### Modified Capabilities
- `agent-plugin-system`: Clarify that failed tool executions must pass through `afterToolCall` with an error result context before the runtime reports the tool failure to the model.

## Impact

- New optional package under `plugins/tool-observer/`.
- New TOON-oriented formatter local to the plugin unless a shared formatter becomes necessary later.
- Runtime tool failure path may need a narrow fix to call `afterToolCall` with `isError: true`.
- No core service API expansion and no runtime internal event payload expansion.
- No database, storage migration, or external service dependency.
