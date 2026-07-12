## Background

`@yesimbot/agent-runtime` currently exposes `extendSystemPrompt(prompt: string, context)`.
Plugins use it as a string pipeline: each active plugin receives the current string and may
return a replacement string. Returning `undefined` keeps the previous value. Hook failures emit
`plugin.error` and fail open.

The runtime passes the final string to `streamText({ system, messages })`. This keeps prompt
extensions in the AI SDK `system` option today, but the API gives plugins only a whole-string
editing surface. Earlier designs considered injecting separate prompt files or plugin prompt
blocks through message transforms, but that exposes system instructions to the historical message
pipeline. Transform, compaction, compatibility, or custom conversion plugins can then see, alter,
remove, reorder, or accidentally merge those instructions into user-visible content.

AI SDK 6.0.177 supports `system?: string | SystemModelMessage | Array<SystemModelMessage>`.
Its own prompt validation warns that system messages in `messages` can be a security risk and
recommends using the `system` option where possible.

## Explored Options

### Option A: Keep `extendSystemPrompt` and add an append-only structured hook

Add a new hook that returns additional system blocks without receiving the entire prompt. The
runtime first resolves the legacy string prompt, then appends structured blocks and maps them to
AI SDK `system`.

Pros:
- Preserves the existing string API and plugin mental model.
- Gives plugins a safer path that cannot rewrite the whole system prompt accidentally.
- Keeps prompt blocks out of `transformMessages` and user content.
- Small implementation and migration surface.

Cons:
- Does not support deletion or reordering in the first version.
- Legacy plugins can still rewrite the whole string through `extendSystemPrompt`.

### Option B: Change `extendSystemPrompt` to accept and return a `SystemInput` union

Broaden `extendSystemPrompt` to `string | SystemModelMessage | SystemModelMessage[]`.

Pros:
- Directly mirrors AI SDK.
- One hook can express append, replace, remove, and reorder.

Cons:
- Every plugin author must type-narrow the input.
- Multi-plugin composition becomes harder to reason about.
- Existing plugins and tests would need migration or compatibility wrappers.
- It weakens the simple "current string in, optional string out" model.

### Option C: Introduce a builder/patch API

Expose operations such as append, replace, remove, or reorder with ids and source metadata.

Pros:
- Most expressive and auditable.
- Can support high-authority prompt governance later.

Cons:
- Too much API for the immediate need.
- Larger test matrix and migration burden.
- Requires rules for conflicts, ordering, and removal authorization.

### Option D: Keep old hook, add explicit structured hook, and define ordering

This is Option A with a clear compatibility rule:

1. Resolve base `systemPrompt`.
2. Run legacy `extendSystemPrompt` in existing deterministic plugin order.
3. Run the new append-only structured hook in the same deterministic plugin order.
4. If structured blocks exist, pass `SystemModelMessage[]` to AI SDK `system`; otherwise preserve
   the old string output.

## Approved Direction

Use Option D.

The new hook is append-only in the first version. It must not allow plugins to delete or reorder
system blocks. Deletion and reordering remain future explicit capabilities if a real need appears.

Existing `extendSystemPrompt(prompt: string, context)` remains source-compatible. Official plugins
should migrate to the structured append hook in this change so new examples steer plugin authors
away from whole-prompt string rewriting.

## Official Plugin Migration Scope

Migrate all current official prompt-extending plugins:

- `core.prompt-files` for `AGENTS.md` and `PERSONA.md`.
- `workspace`.
- `memos-client`.
- `skill`.
- `search-service`.

Prompt extension content must stay in AI SDK `system`, not in `messages` or `transformMessages`.

## Testing Notes

Tests should cover:

- Hook order and `undefined` semantics.
- Fail-open behavior for the new hook.
- Legacy hook remains compatible.
- Runtime maps appended blocks to `streamText` `system`.
- No prompt-file content is duplicated through `transformMessages`.
- Official plugin prompt tests continue to assert expected content without leaking secrets.
