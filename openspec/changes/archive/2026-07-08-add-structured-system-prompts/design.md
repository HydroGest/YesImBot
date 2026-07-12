## Context

`@yesimbot/agent-runtime` currently has one prompt extension surface:
`extendSystemPrompt(prompt: string, context)`. The hook is deterministic,
fail-open, and source-compatible for simple plugins, but it only exposes a whole
string. Official plugins append their guidance by concatenating text to that
string.

The immediate problem is not that the current hook leaks by itself. The final
string is still sent through AI SDK's `system` option. The problem is that
plugins that need prompt segmentation have no structured system-prompt surface
and may be tempted to inject system instructions through `transformMessages`.
Those injected messages become part of the historical message pipeline, where
compaction, compatibility transforms, or custom projections can alter them or
accidentally merge them into user-visible content.

AI SDK 6 supports `system?: string | SystemModelMessage |
Array<SystemModelMessage>`, so the runtime can keep prompt blocks in the
system channel without forcing plugins to manipulate message history.

## Goals / Non-Goals

**Goals:**

- Preserve `extendSystemPrompt(prompt: string, context)` source compatibility.
- Add a new append-only structured system prompt hook.
- Run the legacy string hook first, then append structured system blocks.
- Map structured blocks to AI SDK `system`, never to `messages`.
- Migrate all official prompt-extending plugins to the new hook.
- Keep hook ordering, `undefined`, and fail-open semantics consistent with the
  current plugin system.

**Non-Goals:**

- Do not let the new hook delete, reorder, or rewrite existing system blocks.
- Do not replace `transformMessages` or `toModelMessages`.
- Do not introduce a general prompt builder, prompt ids, priorities, or removal
  authorization in this change.
- Do not change Koishi/core plugin factory context.
- Do not change model providers or introduce new dependencies.

## Decisions

### D1: Add an append-only structured hook

- **Choice**: Add a new top-level `AgentPlugin` hook that appends system prompt
  parts without receiving the full current prompt.
- **Rationale**: Existing real plugins only need to add instruction blocks.
  Append-only behavior is safer than giving every plugin a mutable union of all
  system input.
- **Alternative considered**: Change `extendSystemPrompt` to accept and return
  a `SystemInput` union. Rejected because every plugin would need type
  narrowing and multi-plugin composition would become harder to reason about.

### D2: Keep legacy `extendSystemPrompt` first

- **Choice**: Resolve the base `systemPrompt`, run all legacy
  `extendSystemPrompt` hooks, then collect structured append hooks.
- **Rationale**: This preserves current behavior byte-for-byte when no new hook
  exists, while letting new blocks appear after the legacy base in deterministic
  plugin order.
- **Alternative considered**: Run structured hooks before legacy string hooks.
  Rejected because a later legacy string hook could erase the apparent boundary
  between blocks.

### D3: Preserve string output when no structured blocks exist

- **Choice**: If no structured hook appends anything, pass the final legacy
  prompt as a string to AI SDK as before. If structured blocks exist, pass a
  `SystemModelMessage[]` whose first entry is the legacy string prompt when a
  legacy string exists. If no base string exists, structured blocks may still
  produce system input by themselves.
- **Rationale**: This minimizes behavioral churn and keeps provider request
  shapes stable for existing deployments until a plugin opts in.
- **Alternative considered**: Always convert the final string to a one-element
  system message array. Rejected because it changes request shape for no
  benefit.

### D4: Normalize string blocks to `SystemModelMessage`

- **Choice**: The new hook may return either a string, a `SystemModelMessage`,
  or an array of those values. Runtime normalizes strings to
  `{ role: "system", content }`.
- **Rationale**: Simple plugins can return a string; advanced plugins can attach
  AI SDK provider options such as caching metadata.
- **Alternative considered**: Require only `SystemModelMessage`. Rejected
  because it makes simple appenders noisier without improving safety.

### D5: Keep failures fail-open

- **Choice**: If a structured prompt hook throws, emit `plugin.error` and keep
  the system input built so far.
- **Rationale**: This matches existing prompt extension policy and avoids
  breaking turns because optional guidance failed.
- **Alternative considered**: Fail the turn when a prompt block cannot be
  appended. Rejected because prompt extensions are already in the fail-open
  category.

### D6: Migrate official plugins in the same change

- **Choice**: Move core prompt files, workspace, MemOS, skill, and search-service
  prompt guidance from `extendSystemPrompt` to the new structured hook.
- **Rationale**: Official code should demonstrate the safer API immediately,
  and tests can prove prompt guidance remains in AI SDK `system`.
- **Alternative considered**: Add runtime support only and migrate later.
  Rejected because leaving official examples on the legacy hook would slow
  adoption and obscure the intended pattern.

## Risks / Trade-offs

[Risk] Some providers may treat multiple system messages differently from one
concatenated system string. -> Mitigation: only opt in when structured blocks
exist; official migrations should preserve textual order and use AI SDK's
documented `system` option.

[Risk] Legacy plugins can still rewrite the entire prompt. -> Mitigation:
preserve compatibility but document and test the new structured hook as the
recommended path for additive guidance.

[Risk] Append-only cannot satisfy future prompt governance needs such as removal
or reordering. -> Mitigation: keep those capabilities out of scope until a real
call site exists, then design an explicit higher-authority patch API.

[Trade-off] The runtime will have two prompt hooks for a while. -> Accepted
because it keeps existing plugins working while giving new plugins a clearer
and safer surface.

## Migration Plan

1. Add runtime types and helper support for structured system prompt appends.
2. Add failing tests for hook ordering, fail-open behavior, and final AI SDK
   `system` mapping.
3. Implement the minimal runtime changes.
4. Migrate official prompt-extending plugins to the new hook.
5. Update specs and targeted tests for core and plugins.
6. Rollback strategy: revert plugin migrations first to the legacy hook, then
   remove the new hook if needed. No storage or data migration is involved.

## Open Questions

None for this change. The approved scope is append-only structured prompt
blocks, legacy-first ordering, and migration of all official plugins.
