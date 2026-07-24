## Why

YesImBot currently sends a four-line Athena prompt, resolves prompt extensions for every model call, and permits legacy plugins to rewrite the base prompt. That behavior cannot preserve a persona-defined digital subject, enforce trusted prompt ownership, or guarantee that append-only channel history remains a reusable provider-cache prefix. The project needs an explicit prompt and memory contract before it implements personality evolution or autonomous activity.

## What Changes

**Public subject identity**
- From: Core hardcodes Athena while an optional `PERSONA.md` appends additional instructions.
- To: An immutable identity-neutral constitution defines host invariants, while one versioned active persona fully defines the public subject. The distribution may provide Athena as the default persona.
- Reason: Custom personas must not create two competing identities.
- Impact: Breaking change to current prompt semantics.

**Prompt assembly and cache lifecycle**
- From: Core and plugins resolve system prompt extensions on each model call, and dynamic hooks may change pre-history input or visible tools.
- To: Each ChannelRuntime freezes its constitution, operator policy, persona, stable context, plugin instructions, model, provider, and tool registry. The public Agent interface no longer exposes runtime model or base-tool setters. Per-turn information enters an append-only message timeline. Any stable-prefix change starts a new cache lifecycle.
- Reason: Each normal request must extend the previous request instead of invalidating its prefix.
- Impact: Breaking change to prompt and dynamic-extension contracts.

**Memory ownership and operations**
- From: MemOS provides backend-specific search and add tools plus a prompt policy; Core and agent-runtime define no generic memory behavior.
- To: Memory remains plugin-owned. The design defines search, remember, correct, and forget as optional semantic operations, requires plugins to derive and enforce scope, and forbids prompts from claiming absent operations. MemOS keeps only the operations supported by its current backend integration.
- Reason: Long-term memory needs autonomous curation and correction without coupling the generic runtime to one provider.
- Impact: Additive generic contract plus changes to MemOS prompt and lifecycle requirements.

**Autonomy and evolution**
- The model treats each visible host-permitted tool as authorized and asks only when required intent or arguments are ambiguous.
- Core accepts persona changes only through a trusted operator-managed or optional persona-management capability; ordinary conversation cannot persistently rewrite the active persona.
- Persona proposal, approval, versioning, and rollback remain an optional advanced plugin concern rather than a Core maintenance model.
- Prompt text does not claim background scheduling, no-response behavior, memory mutation, or other runtime capabilities until those capabilities exist.

## Capabilities

### New Capabilities
- `digital-subject-identity`: Defines the identity-neutral constitution, trusted active persona boundary, operator policy boundary, truthful self-description, cross-channel subject continuity, and optional persona-maintenance ownership.
- `system-prompt-composition`: Defines immutable prompt ownership, ChannelRuntime cache lifecycles, frozen stable inputs, append-only dynamic context, and explicit invalidation boundaries.
- `agent-memory-tools`: Defines plugin-owned memory semantics, optional search/remember/correct/forget operations, host-derived scope, selective autonomous curation, and truthful capability reporting.

### Modified Capabilities
- `agent-runtime-core`: Replaces per-call dynamic system-prompt resolution with a frozen stable system input and explicit cache-lifecycle behavior while preserving append-only model history.
- `agent-plugin-system`: Restricts prompt plugins to stable append-only initialization output, resolves deprecated prompt and tool compatibility hooks once, and deprecates historical transformation for new code.
- `core-runtime-integration`: Changes Core prompt ownership, default persona loading, ChannelRuntime prompt snapshots, trusted persona activation, and runtime replacement behavior.
- `memos-cloud-memory`: Aligns MemOS prompt policy and tool behavior with plugin-owned memory semantics, frozen plugin instructions, channel-default memory isolation, explicit persistence outcomes, supported-operation disclosure, and removal of model-selected cross-channel debug scope.

## Impact

The implementation affects `packages/agent-runtime` model-call preparation, the public Agent interface, and plugin contracts; Core ChannelRuntime initialization, reload coordination, and bundled prompt constants under `core/src/runtime/prompts`; runtime `AGENTS.md` and `PERSONA.md` loading; and `plugins/memos-client`. Removing `Agent.setModel()` and `Agent.setTools()` is a breaking API change. Deprecated prompt and tool hooks keep source compatibility but resolve once during initialization, while `transformMessages` remains only as a deprecated compatibility surface. Existing channel JSONL remains append-only and requires no data migration. Fixed-model behavior evaluation and provider cache token, latency, and cost measurement are deferred to a separate OpenSpec change.
