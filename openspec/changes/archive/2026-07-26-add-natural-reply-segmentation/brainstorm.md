# Brainstorm: Natural Reply Segmentation

Raw decision log. Captures the exploration that produced `design.md`, including
rejected alternatives and the reasoning behind each fork.

## Background

Athena's vision document states the goal is not to reply faster but to exist more
appropriately in a group channel ("不是更快地回复，而是更合适地存在"). Current
behaviour contradicts that at the delivery layer: one assistant message becomes
exactly one platform message, so every reply arrives as a single block whose shape
carries no information about tone, urgency, or hesitation.

Segmentation was attempted twice before, and both attempts are preserved under
`references/`:

- `references/nekochan/SOUL.md` put the protocol in the persona:
  "一条消息说不完用 `<sep/>` 分开发". Prompt-only. The model settled into a stable
  habit of two separators per reply, producing three messages nearly every time.
- `references/YesImBot-v4-dev/core-legacy/src/internal/delivery.ts` implemented
  `splitDeliverySegments` plus `planDeliveryTiming`, with a `mulberry32` seeded PRNG
  and weighted target counts (one 0.45 / two 0.40 / three 0.15). The runtime merged
  segments to hit those weights. This replaced a model-side template with a
  runtime-side template.

The observed failure in both cases is the same: **a fixed distribution of message
counts**, regardless of which layer chose it. Any new design has to treat
"avoid becoming a new template" as a first-class requirement rather than a
side effect of good prompting.

Repository reality check performed before designing:

- No segmentation code exists anywhere in the current tree. Searching `sep/`,
  `split`, `segment`, `typing`, `sleep`, `setTimeout` outside `references/` returns
  only storage path validation and media download timeouts.
- There is no `deliver` function. Passive delivery is a loop inside
  `core/src/gateway/index.ts:150-162` calling `session.send(output.content)` per item.
- `ChannelOutput` is already per-message, not per-turn, and `OutputQueue` is already
  an ordered async FIFO. Multi-message delivery therefore needs no new transport;
  it needs more items pushed into an existing queue.
- `renderAssistantContent` (`core/src/runtime/index.ts:473-487`) is the single text
  egress point. Every visible character passes through it exactly once.

## Two hard constraints discovered during research

These shaped the design more than the choice of separator did.

**C1 — `inner_thought` was forbidden by an existing spec.**
`openspec/specs/digital-subject-identity/spec.md` states the system prompt
"MUST NOT require chain-of-thought text, a visible `inner_thought` field, or
storage of private reasoning." Letta's design could not be borrowed as-is without
a requirement change. Resolved by narrowing the prohibition (see Q5).

**C2 — Prompt segments must be byte-stable within a ChannelRuntime lifecycle.**
`openspec/specs/system-prompt-composition/spec.md` freezes stable segments to
preserve provider prefix caches. This rules out the most obvious anti-template
trick: injecting a per-turn randomized instruction such as "aim for two messages
this time". Randomness cannot live in the prompt. It can only live in the runtime,
and the previous implementation proved it must not be applied to structure.

Combined consequence: **structure comes from the model with zero runtime
randomness; randomness applies only to timing.** Structural randomness is
deceptive and produced the earlier failure; timing randomness is what actually
reads as human.

## Decision chain

### Q1 — Where does the segmentation decision belong?

Three candidates were compared.

**A. Prompt-only.** Model emits separators, runtime splits naively.
High natural-language ceiling, no format guarantee, and historically collapsed
into a fixed pattern. Sensitive to provider quality with no floor.

**B. Runtime-only.** Model emits plain text, code splits on punctuation or semantics.
Perfectly reliable format, but the splitter has no access to intent, emotion, or
persona. It cannot know that a sentence is a punchline, a correction, or a warning.
Ceiling is low and cannot be raised by better models.

**C. Hybrid — model plans, runtime validates and degrades.**
Ceiling comes from the model, floor comes from the code.

**Decision: C**, with three deliberate differences from the previous hybrid attempt:

1. No target segment count. The concept of `targetCountWeights` is deleted outright.
   The runtime never splits or merges to reach a number.
2. Randomness applies to timing only, never to structure.
3. Protection zones are evaluated before any splitting, and a separator inside a
   protection zone is preserved as literal text rather than deleted.

### Q2 — Keep `<sep/>` as the protocol?

**Decision: yes.** Rejected alternatives:

- **Double newline `\n\n`.** Collides with Markdown paragraph semantics. The model
  cannot distinguish "format as paragraphs" from "send as separate messages", and
  neither can the parser.
- **JSON array of strings.** Breaks streaming, and pushing the model into
  structured-output mode measurably flattens conversational voice.
- **One tool call per message.** High latency, high token cost, and it conflicts
  with passive-delivery semantics where the Session owns the send.

`<sep/>` wins because it is already coherent with Koishi/Satori element syntax,
which means the same lexer handles it and every other element in the stream, and
the escape story (`&lt;sep/&gt;`) is the one the platform already uses.

### Q3 — What happens on partial failure?

**Decision: stop on first failure, never retry.**
The existing loop continues to the next output after a failed send. For segments
that is wrong: if message 2 of 4 fails, pushing 3 and 4 produces an incoherent
fragment sequence. Retry was rejected because a send that failed after the platform
accepted it produces a duplicate, and duplicates are worse than truncation.
`delivery.failed` carries segment index and total so the failure is diagnosable.

### Q4 — Store raw or sanitized text in JSONL?

**Decision: raw**, including every control element.

Rationale: it preserves model intent for offline evaluation of segmentation quality,
avoids a dual-format storage path (YAGNI), and lets historical projection replay
inner thoughts to the model, which is the mechanism that stabilizes persona.

Accepted risk: the model sees its own past separators, which could reinforce a
habit. This is the main reason the anti-template metrics in the verification plan
measure run length rather than average count.

### Q5 — Implement `inner_thought`?

**Decision: yes**, borrowing Letta's framing, and narrow the blocking requirement.

Letta's base instructions state: "When you write a response, you express your inner
monologue (private to you only) before taking any action, this is how you think."
Field practice on this project found inner monologue helps persona self-consistency,
which matches Letta's rationale.

The existing prohibition conflates two different things. What actually matters is
that private deliberation never reaches a reader. Whether it exists as a structured
element inside the internal protocol is an implementation concern. The requirement
narrows to: an inner-thought element is permitted if the host parser strips it
before delivery, storage is internal-only, and no persona can disable stripping.

Rejected alternative: rely solely on provider-native reasoning channels. That was
the original plan under constraint C1, but it is provider-dependent, invisible to
the persona, unavailable for replay, and therefore useless for cross-turn identity
continuity.

### Q6 — How is pacing computed?

**Decision: borrow the v3 formula**, from
`references/YesImBot-v3-dev/packages/core/src/services/plugin/builtin/core-util.ts`.
It derives delay from character count with separate CJK and Latin rates, applies a
bounded random factor, and clamps to a floor and ceiling.

Two corrections to the v3 behaviour:

- Subtract already-elapsed model generation time from the first segment's delay,
  keeping a small random residual buffer so the first message still lands with a
  perceptible beat instead of instantly.
- Drop v3's separate fixed "paragraph delay" applied on top of the typing delay.
  Two stacked delay sources are harder to reason about and easier to perceive as a
  formula.

Explicitly rejected: deriving delay from a simulated words-per-minute typing model
with visible acceleration curves. That is the most recognizable mechanical tell.

### Q7 — Should the model be able to request a pause?

**Decision: yes, `<sleep ms="N"/>`, additive to the computed delay**, capped per
segment. Additive rather than override because the intent behind an explicit pause
is "longer than normal here", which composition expresses directly.

### Q8 — Should the model be able to decline after generation?

**Decision: yes, `<skip/>`.**
The WillEngine decides before generation and therefore without the understanding
that generation produces. `<skip/>` covers the case where reading the context is
what reveals that silence is the right move. It is not a WillEngine replacement:
a skipped turn still costs a full model call, so the WillEngine remains the cheap
first filter.

`WillEngine.onReply()` must not fire for a skipped turn, since no reply occurred.

### Q9 — Begin delivery during streaming?

**Decision: no, deferred.**
Protection-zone detection needs the complete message. An unterminated code fence
mid-stream is indistinguishable from a fence that will be closed by a later token,
so splitting early risks cutting code. The cost is first-token latency, which is
partially offset by Q6's elapsed-time subtraction.

### Q10 — Where in the prompt does the protocol go?

**Decision: inside the Core Constitution, raising it to version 2.**

A plugin-contributed block was rejected because plugin blocks append after the
persona, and a persona could then plausibly outrank the protocol. Delivery-shape
control is a host invariant, so it belongs where host invariants already live.

The persona may describe *habits of thought* ("think about how you feel before
choosing words"), but it must not define or redefine protocol elements.

Accepted cost: version 2 invalidates every provider cache prefix and rebuilds every
ChannelRuntime once.

### Q11 — How do the prompt examples avoid teaching a template?

**Decision: give almost none.**
The instruction carries only two contrasting shapes stated abstractly, with no
character counts, no message counts, and no worked dialogue. This was a deliberate
inversion of the usual "more examples is better" instinct: with segmentation, every
concrete example is a pattern the model can imitate literally, and imitation is
exactly the failure mode being designed against.

## Design trade-offs accepted

**[Trade-off] Latency for naturalness.** A four-segment reply now takes several
seconds of wall clock instead of milliseconds. Accepted because simultaneous arrival
of four messages reads worse than one long message; a total-delivery ceiling bounds
the worst case.

**[Trade-off] Wasted model calls on `<skip/>`.** A skipped turn costs full
generation. Accepted because the WillEngine still filters cheaply beforehand, and
context-aware silence is not obtainable any other way.

**[Trade-off] Raw storage reinforces habits.** Replaying past separators to the
model may entrench patterns. Accepted for persona continuity, mitigated by measuring
run length in verification rather than average segment count.

**[Trade-off] No streaming delivery.** Accepted for content safety around code
fences; revisitable if first-token latency proves worse than expected.

**[Risk] Protocol leakage into visible messages.** A parser bug prints
`<sep/>` to users. → Mitigation: strip-then-assert; any residual control element in
a rendered segment fails the segment into single-message degradation rather than
being sent.

**[Risk] The model treats the protocol as decoration.** Weak models may emit
separators randomly or ignore them entirely. → Mitigation: ignoring them degrades
to today's behaviour, which is acceptable; per-provider compliance and degradation
rates are measured rather than assumed.

**[Risk] New template formation.** → Mitigation: this is the primary verification
target, not an afterthought. Sliding-window entropy and maximum run length of
identical segment counts are tracked, with a defined degradation alarm.

## Non-goals settled during exploration

- No streaming/incremental segment delivery.
- No retry of failed segments.
- No recall or edit of already-delivered segments when a turn is cancelled.
- No runtime-side semantic sentence splitting as a fallback; degradation is always
  to a single complete message.
- No changes to `packages/agent-runtime`; OCL is a Core delivery concern.
- No persona-authored protocol extensions.
