## Why

Athena delivers each assistant message as exactly one platform message, so a reply arrives as one block of text regardless of its length, tone, or urgency. Real participants in group chat split thoughts across messages, pause between them, occasionally stay silent, and vary that shape constantly. An earlier `<sep/>` experiment failed from both directions: prompt-only splitting collapsed into a fixed pattern, and runtime weighted merging replaced one template with another. Athena also has no private deliberation channel, which weakens persona consistency across turns. The project needs an explicit output-shape contract before further persona work can produce a believable participant.

## What Changes

**Model output protocol**
- From: Assistant output is plain text; every text part is concatenated and delivered verbatim as one message.
- To: Assistant output is an Output Control Language (OCL) stream that mixes visible content with four host-owned control elements: `<inner_thought>`, `<sep/>`, `<sleep ms="N"/>`, and `<skip/>`. The runtime parses, strips, and enforces them.
- Reason: Segmentation, pacing, private deliberation, and declining to speak are all delivery-shape decisions that need one protocol rather than four mechanisms.
- Impact: Breaking change to assistant output semantics and to `renderAssistantContent`.

**Segmentation authority**
- From: No segmentation exists.
- To: The model decides segment count, position, and length. The runtime never splits or merges to reach a target count; it only enforces protection zones, hard guardrails, and degradation.
- Reason: Runtime-chosen counts produced the fixed-template failure the previous implementation was built around.
- Impact: New parsing stage between agent output and Gateway delivery.

**Private deliberation**
- From: The constitution forbids exposing chain-of-thought, and `digital-subject-identity` forbids a visible `inner_thought` field outright.
- To: `<inner_thought>` becomes part of the internal output protocol. It is stripped before delivery, retained raw in channel JSONL, and replayed to the model as its own history. The prohibition narrows from "no inner_thought field" to "never user-visible".
- Reason: Inner monologue measurably stabilizes persona self-consistency; the real invariant is user invisibility, not absence.
- Impact: Requirement change in `digital-subject-identity`.

**Delivery of one logical reply**
- From: One assistant message produces one `ChannelOutput` and one `Session.send()`.
- To: One assistant message produces N ordered `ChannelOutput` items carrying segment index and total. Delivery stops at the first failure, honours abort between segments, and never retries.
- Reason: Partial delivery is the honest outcome in chat; retry produces duplicate messages.
- Impact: `ChannelOutput` gains fields; `delivery.failed` gains segment position.

**Human-like pacing**
- From: Outputs are sent as fast as the platform accepts them.
- To: Each segment is preceded by a character-count-derived typing delay with bounded randomness, plus any additive `<sleep>` hint, under per-segment and total-delivery ceilings.
- Reason: Simultaneous arrival of several messages reads more mechanical than one long message.
- Impact: Gateway delivery loop becomes time-aware and abort-aware.

**Declining to speak after seeing context**
- From: Only the pre-generation WillEngine can decide not to reply.
- To: `<skip/>` lets the model decline after reading context. No message is delivered, the decision is persisted, and `WillEngine.onReply()` is not called.
- Reason: Some silence decisions require the context that only generation reveals.
- Impact: Requirement change in `channel-will-evaluation`.

**Identity ownership**
- From: The constitution opens by asserting that the subject is a digital subject hosted by YesImBot and requires it to describe its software nature, while also claiming to be identity-neutral.
- To: The constitution asserts no identity. The active persona is the sole identity source and owns diegetic self-narrative including embodiment, routine, physical states, and feelings. Action truthfulness is retained in full; a narrow floor keeps the subject from denying it is an automated system when sincerely asked outside the fiction.
- Reason: Two identity sources existed with the constitution outranking the persona, so the model resolved conflicts toward the runtime identity and produced persona-inconsistent replies. The constitution also violated its own identity-neutrality requirement.
- Impact: Requirement changes in `digital-subject-identity`; behavioural change to persona fidelity.

**Constitution version**
- From: `CORE_CONSTITUTION_VERSION = 1`.
- To: Version 2, adding an inner-thought and message-shape section. This invalidates every provider cache prefix and rebuilds every ChannelRuntime.
- Reason: The protocol must outrank persona and user instructions, so it belongs in the constitution.
- Impact: Accepted one-time cache invalidation.

## Capabilities

### New Capabilities
- `reply-output-control-language`: Defines OCL grammar, element semantics, protection zones, the ordered parsing algorithm, hard guardrails, degradation rules, and the invariant that no control element reaches a reader.

### Modified Capabilities
- `message-delivery`: Adds multi-segment passive delivery, segment-indexed failure records, stop-on-first-failure, abort-between-segments, no-retry, and bounded pacing.
- `system-prompt-composition`: Raises the constitution to version 2 and places the OCL contract in a stable segment that plugins and personas cannot override.
- `digital-subject-identity`: Narrows the private-deliberation prohibition from "no `inner_thought` field" to "never user-visible"; removes the host-runtime self-description and the requirement to disclose software nature; makes the persona the sole identity source owning diegetic self-narrative; scopes truthfulness to capabilities, observations, and completed actions plus a narrow sincere-inquiry floor.
- `channel-will-evaluation`: Excludes `<skip/>` turns from the successful-reply notification.

## Impact

Affects `core/src/runtime/index.ts` (`renderAssistantContent`, `ChannelOutput`, `OutputQueue`), `core/src/gateway/index.ts` (delivery loop, `failDelivery`), `core/src/runtime/prompts/constitution.ts`, and a new OCL parser plus pacing module under `core/src`. `packages/agent-runtime` is untouched: OCL is a Core delivery concern, not a runtime-core concern, and the parser runs at the existing single text egress point.

Channel JSONL stores raw model output including control elements, so no migration is required and no dual-format read path is introduced. Historical projection replays inner thoughts to the model unchanged. Raising the constitution version drains and rebuilds every ChannelRuntime once on upgrade, discarding accumulated provider cache prefixes; this cost is accepted.

Delivery latency increases by design. A multi-segment reply now occupies seconds rather than milliseconds of wall clock, bounded by a total-delivery ceiling. Streaming partial segments during generation is explicitly deferred, because protection-zone detection requires the complete message.
