## 1. Runtime API And Composition

- [x] 1.1 Add failing runtime tests for the structured system prompt append hook, including string blocks, `SystemModelMessage` blocks, array returns, `undefined`, ordering, and fail-open diagnostics.
- [x] 1.2 Add a failing runtime model-call test proving appended structured blocks are sent through AI SDK `system` and not through model `messages`.
- [x] 1.3 Add public runtime types for the append-only structured system prompt hook while keeping `extendSystemPrompt(prompt: string, context)` source-compatible.
- [x] 1.4 Implement plugin host composition so legacy `extendSystemPrompt` runs first and structured system prompt append hooks run afterward in deterministic plugin order.
- [x] 1.5 Update agent system prompt resolution to return AI SDK-compatible system input while preserving string output when no structured blocks exist.

## 2. Official Plugin Migration

- [x] 2.1 Migrate `core.prompt-files` to append `AGENTS.md` and `PERSONA.md` through the structured system prompt hook.
- [x] 2.2 Migrate the workspace plugin prompt guidance to the structured system prompt hook.
- [x] 2.3 Migrate the MemOS client prompt policy to the structured system prompt hook.
- [x] 2.4 Migrate the skill plugin prompt guidance to the structured system prompt hook.
- [x] 2.5 Migrate the search-service prompt guidance to the structured system prompt hook.

## 3. Tests And Verification

- [x] 3.1 Update core prompt tests to assert structured prompt blocks and missing-file behavior.
- [x] 3.2 Update workspace and MemOS plugin tests to assert prompt guidance through the structured hook.
- [x] 3.3 Add or update tests for skill and search-service prompt migration if their packages have suitable test coverage.
- [x] 3.4 Run targeted runtime, core, workspace, MemOS, skill, and search-service verification commands.
- [x] 3.5 Update this task list with completed checkboxes only after implementation and verification pass.
