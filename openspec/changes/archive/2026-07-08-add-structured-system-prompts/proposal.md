## Why

Plugins currently modify the system prompt through a whole-string
`extendSystemPrompt` hook. That keeps existing behavior simple, but it gives
plugins no safe way to append separate system prompt blocks. The alternative of
injecting prompt content through message transforms risks exposing system
instructions to history shaping and user-content conversion. This change adds a
structured append path that maps directly to AI SDK's `system` option while
keeping the old API compatible.

## What Changes

**Runtime prompt extension API**
- From: Plugins can only receive and return a complete system prompt string.
- To: Plugins can keep using the legacy string hook or use a new append-only
  structured system prompt hook.
- Reason: Add prompt segmentation without forcing plugin authors to manipulate
  a broad union type or use `transformMessages`.
- Impact: Non-breaking public API addition.

**Prompt composition order**
- From: Base system prompt and legacy `extendSystemPrompt` hooks produce one
  string.
- To: The runtime resolves the base string, runs legacy hooks first, then
  appends structured system blocks in deterministic plugin order.
- Reason: Preserve current behavior while giving structured blocks clear
  composition semantics.
- Impact: Existing plugins remain source-compatible; migrated plugins now
  produce separate AI SDK system blocks.

**Official plugin migration**
- From: Core prompt files, workspace, MemOS, skill, and search-service append
  prompt guidance by string concatenation.
- To: Those plugins append structured system prompt blocks.
- Reason: Official plugins should demonstrate the safer API and avoid message
  transform prompt injection patterns.
- Impact: Tests update to validate the new hook while preserving expected
  prompt content.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `agent-plugin-system`: Adds the structured system prompt append hook and its
  ordering/error semantics.
- `agent-runtime-core`: Allows resolved runtime system prompt input to become an
  AI SDK-compatible system string or system message array at the model boundary.
- `core-runtime-integration`: Keeps prompt files in runtime system input through
  the new structured hook instead of whole-string prompt rewriting.
- `workspace-sandbox-tools`: Migrates workspace prompt guidance to the new
  structured system prompt hook.
- `memos-cloud-memory`: Migrates memory policy prompt guidance to the new
  structured system prompt hook.

## Impact

- Affected runtime files: `packages/agent-runtime/src/types/plugin.ts`,
  `packages/agent-runtime/src/plugin.ts`, and `packages/agent-runtime/src/agent.ts`.
- Affected core/plugin files: `core/src/runtime/prompt.ts`,
  `plugins/workspace/src/index.ts`, `plugins/memos-client/src/index.ts`,
  `plugins/skill/src/index.ts`, and `plugins/search-service/src/index.ts`.
- Affected tests: targeted runtime, core, workspace, and MemOS plugin tests.
- Dependencies: none.
- Storage/data migration: none.
