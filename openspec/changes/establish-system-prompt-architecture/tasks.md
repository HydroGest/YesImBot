## 1. Freeze Agent Runtime Resources

- [ ] 1.1 Add agent-runtime tests for one-time `systemPrompt` resolution, structured system blocks, preserved `providerOptions`, and base-prompt failure before plugin startup.
- [ ] 1.2 Refactor plugin initialization to resolve stable tools and prompt blocks once, roll back required-plugin failures, and disable optional plugins without retaining partial resources.
- [ ] 1.3 Resolve deprecated `extendSystemPrompt` and `extendTools` hooks once during initialization, mark both hooks and `transformMessages` deprecated, and keep structured Core input outside the legacy prompt reducer.
- [ ] 1.4 Remove `Agent.setModel()` and `Agent.setTools()`, freeze model/system/tools for the Agent lifetime, and update public type tests and all affected callers.
- [ ] 1.5 Add model-call regression tests proving later turns and tool-loop steps reuse the frozen system/tool snapshot and extend persisted model history at the tail.

## 2. Build The Core Prompt Snapshot

- [ ] 2.1 Add bundled TypeScript constants for Constitution version 1 and the approved default Athena persona, and remove the unused legacy `core/resources/prompts/system.md` resource.
- [ ] 2.2 Replace `core.prompt-files` with a one-time Core system-input resolver that composes Constitution, optional `<agents>`, exactly one `<persona>`, and XML-escaped `<runtime_context>` Channel Scope fields in the approved order.
- [ ] 2.3 Add Core prompt tests for custom-persona replacement, default-persona fallback, empty and missing files, non-`ENOENT` fail-closed errors, stable segment ordering, and frozen file contents.
- [ ] 2.4 Add idempotent `ChannelRuntime.init()` and make `RuntimeManager.createRuntime()` await it before publishing an active runtime entry.

## 3. Add Non-Destructive Runtime Reload

- [ ] 3.1 Add RuntimeManager tests for active-runtime reload, uncached-channel no-op behavior, assignment validation, preserved JSONL/assets/workspace/namespaces, and fail-closed drain failures.
- [ ] 3.2 Implement `RuntimeManager.reload(scope)` and public `YesImBotService.reload(scope)` by reusing the existing per-Key handover coordinator without invoking reset semantics.
- [ ] 3.3 Add a dedicated draining error and retry racing EventRecords through the existing five-waiter handover path so reload does not drop accepted events.
- [ ] 3.4 Add concurrency tests proving same-generation reload calls coalesce and the next accepted event lazily creates one fresh prompt/tool/model snapshot.

## 4. Align MemOS Memory Behavior

- [ ] 4.1 Replace the MemOS stable policy with the approved search/add-only text and verify plugin initialization freezes it for the Agent lifecycle.
- [ ] 4.2 Change `search_message` and `add_message` to discriminated `completed`/`persisted`/`accepted`/`failed` outcomes and update tool tests for synchronous, asynchronous, empty-result, and sanitized-failure cases.
- [ ] 4.3 Remove `debug_search_channel_memory` and `enableDebugTools`, then update config, plugin registration, identity, and isolation tests so model arguments cannot widen memory scope.

## 5. Verify The Cutover

- [ ] 5.1 Run the targeted agent-runtime, Core, and MemOS test files that cover the changed contracts.
- [ ] 5.2 Run package-scoped type checks and builds for `@yesimbot/agent-runtime`, `koishi-plugin-yesimbot`, and `koishi-plugin-yesimbot-memos-client`.
- [ ] 5.3 Validate the OpenSpec change and record any environment-only skipped checks without adding fixed-model or provider-cache evaluation to this change.
