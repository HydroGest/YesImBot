## 1. Package Scaffold

- [x] 1.1 Create `packages/agent-runtime` workspace package with build, typecheck, test, and public exports.
- [x] 1.2 Add initial test harness and package-boundary tests proving the new package is independent from `packages/agent` and `core`.

## 2. Core Type Surface

- [x] 2.1 Define message, entry, state, event, turn, storage, and plugin public types.
- [x] 2.2 Add type-level tests for declaration merging of custom messages, entries, state, events, and hooks.
- [x] 2.3 Implement message constructor and entry creation helpers, including required `AgentMessage.meta.id` and separate `AgentEntry.id`.

## 3. Storage, Channel, and State Primitives

- [x] 3.1 Implement `AgentStorage`, in-memory storage, and append-only entry helpers.
- [x] 3.2 Implement typed channel subscribe/emit semantics and core runtime event shapes.
- [x] 3.3 Implement JSON-serializable state manager with state-entry persistence.

## 4. Plugin Lifecycle and Hook Pipeline

- [x] 4.1 Implement plugin ordering, idempotent lazy init, reverse-order stop, and explicit `optional: true` plugin handling.
- [x] 4.2 Implement hook pipeline utilities for append, message transform, system prompt/tool extension, model conversion, and turn finish.
- [x] 4.3 Implement plugin error policies and diagnostics for fail-closed and fail-open hook categories.

## 5. Append Pipeline and Runtime Shell

- [x] 5.1 Implement `createAgent()` and core runtime resource management for model, system prompt, tools, storage, state, channel, and plugins.
- [x] 5.2 Implement `append()` as a non-response operation that accepts constructed `AgentMessage` values, runs only append hooks, persists entries, and emits `message.appended`.
- [x] 5.3 Ensure `append()` never invokes model hooks, tool hooks, or turn-finish hooks.

## 6. Turn Queue and Result Lifecycle

- [x] 6.1 Implement `send()`, `run()`, and `waitTurn()` with retained `TurnResult` values.
- [x] 6.2 Implement busy behavior `ifBusy: 'defer' | 'join' | 'reject'`, including joined-message persistence with active `turnId`.
- [x] 6.3 Implement abnormal terminal event persistence for `turn.failed` and `turn.aborted` only.

## 7. AI SDK Model Execution and Tool Hooks

- [x] 7.1 Implement historical `transformMessages` and `toModelMessages` conversion boundary for `ai-sdk`.
- [x] 7.2 Implement `streamText` model execution, stream channel events, and step-level assistant/tool output persistence.
- [x] 7.3 Implement base tools, plugin `extendTools`, conflict detection, serial multi-tool execution, and `beforeToolCall` / `afterToolCall` hook composition.
- [x] 7.4 Ensure runtime core classifies failed attempts and does not automatically retry.

## 8. Dogfood Plugins, Public API, and Verification

- [x] 8.1 Implement `compactPlugin` as the first plugin-system validation case using custom entries, state, transforms, and model conversion.
- [x] 8.2 Implement `auditPlugin` as a development/debug plugin that subscribes to channel events and optionally persists diagnostics.
- [x] 8.3 Add README/API examples for `append`, `send`, `run`, `waitTurn`, plugins, storage, compact, and audit.
- [x] 8.4 Run package-scoped typecheck, tests, build, and OpenSpec validation.
