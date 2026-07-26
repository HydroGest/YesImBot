## Context

Athena's passive delivery path currently maps one assistant message to one platform
message. `renderAssistantContent` (`core/src/runtime/index.ts:473-487`) concatenates
every text part of an assistant message, drops it if blank, and hands a single
`Fragment` to `OutputQueue`. The Gateway loop (`core/src/gateway/index.ts:150-162`)
then calls `session.send()` once per queued item.

Two properties of the existing code make this change cheaper than it first appears:

- `ChannelOutput` is already per-message rather than per-turn, and `OutputQueue` is
  already an ordered async FIFO with failure propagation. Multi-message delivery
  requires pushing more items into an existing transport, not a new transport.
- `renderAssistantContent` is the single egress point for visible text, so the
  parser has exactly one insertion site.

Constraints carried in from existing specs:

- `system-prompt-composition` freezes stable prompt segments per ChannelRuntime
  lifecycle to preserve provider prefix caches. No per-turn prompt randomization.
- `digital-subject-identity` currently forbids a visible `inner_thought` field
  outright, which this change narrows.
- `message-delivery` requires the Gateway to own `Session.send()` and forbids
  ChannelRuntime from holding a Session. Segmentation must not move send authority.

Prior art lives under `references/` and is documented in `brainstorm.md`. Both
earlier attempts failed by producing a fixed distribution of message counts, one
from the prompt side and one from the runtime side.

## Goals / Non-Goals

**Goals:**

- One logical reply may be delivered as a variable number of ordered platform
  messages, with count, position, and length chosen by the model from context.
- Segment shape varies with semantics, emotion, scene, and persona instead of
  converging on a fixed template.
- A private deliberation channel (`<inner_thought>`) that never reaches a reader and
  is replayed to the model to stabilize persona continuity.
- Model-requestable pacing (`<sleep>`) and model-requestable silence (`<skip/>`).
- Content integrity: code, links, structured content, and platform elements are
  never split.
- Safe degradation: any parse or validation failure produces one complete message
  rather than a lost or corrupted reply.
- Bounded worst case: maximum segment count, per-segment delay ceiling, and total
  delivery ceiling.

**Non-Goals:**

- Streaming or incremental delivery of segments during generation.
- Retrying failed segments, or recalling delivered segments on cancellation.
- Runtime-side semantic sentence splitting as a fallback strategy.
- Changes to `packages/agent-runtime`.
- Persona-authored or plugin-authored protocol elements.
- Per-platform delivery adapters or rewriting the Satori/Koishi encoder.

## Decisions

### D1: Hybrid authority — model plans structure, runtime enforces safety

- **Choice**: The model chooses segment count, split positions, and segment length.
  The runtime never splits text the model did not mark, and never merges segments to
  reach a target count. Runtime authority is limited to protection zones, hard
  guardrails, and degradation.
- **Rationale**: The natural-language ceiling requires model judgment about intent,
  emotion, and persona. The reliability floor requires code. Separating "who chooses
  shape" from "who guarantees safety" gives both without either overriding the other.
- **Alternatives considered**: Prompt-only (no format floor; historically collapsed
  into a fixed pattern). Runtime-only (reliable but semantically blind, and its
  ceiling cannot rise with model quality).

### D2: No target segment count anywhere in the runtime

- **Choice**: Delete the `targetCountWeights` concept from the previous
  implementation. The runtime has no opinion about how many messages are desirable.
- **Rationale**: The prior implementation's weighted merge (one 0.45 / two 0.40 /
  three 0.15) replaced a model-side template with a runtime-side template. A fixed
  distribution is the defect regardless of which layer imposes it.
- **Alternatives considered**: Adaptive weights based on recent history. Rejected as
  a more sophisticated way to produce the same class of artifact, and it would make
  behaviour depend on hidden state that is hard to explain or test.

### D3: Randomness applies to timing only, never to structure

- **Choice**: Segment boundaries are fully deterministic given model output. Delays
  carry bounded randomness.
- **Rationale**: Structural randomness changes what is said and can corrupt meaning;
  timing randomness changes only when it arrives, which is the dimension where real
  human variance actually lives. This also keeps the parser deterministic and
  therefore testable without seed injection.
- **Alternatives considered**: Seeded structural PRNG as in the prior implementation.
  Rejected per D2.

### D4: Output Control Language over Koishi element syntax

- **Choice**: Control semantics are expressed as XML-ish elements consistent with
  Koishi message elements: `<inner_thought>…</inner_thought>`, `<sep/>`,
  `<sleep ms="N"/>`, `<skip/>`.
- **Rationale**: One lexer handles control elements and platform elements uniformly.
  The escape convention (`&lt;sep/&gt;`) is the one the platform already defines.
  Adding a future control element does not require a new protocol layer.
- **Alternatives considered**: Double newline (collides with Markdown paragraph
  semantics; ambiguous to both model and parser). JSON array output (breaks
  streaming, and structured-output mode flattens conversational voice). One tool call
  per message (latency, token cost, and conflicts with passive-delivery semantics).

### D5: Ordered parsing algorithm with protection zones first

- **Choice**: Parsing proceeds in a strict order:

  1. Identify protection zones: fenced code blocks, inline code, URLs, and
     non-control platform elements (`<at>`, `<img>`, `<quote>`, …).
  2. Extract `<inner_thought>` regions outside protection zones; retain as metadata;
     remove from the delivery stream.
  3. If `<skip/>` occurs outside a protection zone, discard all visible content and
     produce zero outputs.
  4. Split the remainder on `<sep/>` occurrences outside protection zones.
  5. Per segment: sum `<sleep ms="N"/>` hints, remove the markers, trim, and drop the
     segment if empty.
  6. Apply guardrails: truncate beyond the maximum segment count; if zero segments
     remain, degrade to one message.
  7. Assert no residual control element survives in any segment.

- **Rationale**: Protection zones must be computed before any split decision, or a
  separator inside a code block will cut the block. Control elements inside a
  protection zone are preserved as literal text rather than deleted, because deleting
  them would silently corrupt quoted or sample content.
- **Alternatives considered**: Split first, then repair broken fences. Rejected:
  repair requires guessing intent and can produce syntactically valid but semantically
  wrong output.

### D6: `<inner_thought>` is internal-only, stored raw, replayed to the model

- **Choice**: Inner thoughts are stripped before delivery, stored verbatim in channel
  JSONL as part of the raw assistant output, and replayed to the model as its own
  history without modification. They do not contribute to typing-delay computation.
- **Rationale**: Replay is the mechanism that produces cross-turn persona
  consistency; stripping is the invariant that protects the reader. Storing raw
  avoids a dual-format storage path and preserves data for offline evaluation.
- **Alternatives considered**: Provider-native reasoning channels only
  (provider-dependent, not replayable, invisible to persona). Storing a sanitized
  copy alongside the raw copy (two formats, no current consumer, YAGNI).

### D7: Narrow the private-deliberation prohibition rather than avoid the feature

- **Choice**: `digital-subject-identity` changes from forbidding a visible
  `inner_thought` field to forbidding user-visible deliberation. An inner-thought
  element is permitted when the host parser strips it before delivery, storage is
  internal-only, and no persona can disable stripping.
- **Rationale**: The invariant worth protecting is that private reasoning never
  reaches a reader. Prohibiting the mechanism rather than the exposure blocked a
  feature with demonstrated value while protecting nothing additional.
- **Alternatives considered**: Leave the spec unchanged and omit inner thought.
  Rejected: it discards the persona-consistency benefit that motivated the change.

### D8: `<sleep ms="N"/>` is additive to the computed delay, with ceilings

- **Choice**: Each segment's delay is the character-derived typing delay plus the sum
  of that segment's `<sleep>` hints, clamped to a per-segment ceiling. Total delivery
  time is separately bounded; segments exceeding the total ceiling are delivered with
  minimum spacing rather than dropped.
- **Rationale**: An explicit pause expresses "longer than usual here", which addition
  models directly. Ceilings prevent a single hint from stalling a channel, and
  clamping rather than dropping keeps content integrity above pacing fidelity.
- **Alternatives considered**: Override semantics (loses the baseline relationship to
  segment length). Ignoring hints entirely (removes model agency over rhythm, which
  is a main source of variation).

### D9: Typing delay borrows the v3 formula with two corrections

- **Choice**: Delay derives from visible character count with distinct CJK and Latin
  rates, a bounded random factor, and a floor and ceiling, as in
  `references/YesImBot-v3-dev/.../core-util.ts`. Corrections: subtract elapsed model
  generation time from the first segment's delay while retaining a small random
  residual buffer; drop v3's separate fixed paragraph delay stacked on top.
- **Rationale**: The formula is proven and cheap. Subtracting elapsed generation time
  keeps perceived latency honest, since the user has already been waiting. Removing
  the second stacked delay source makes pacing explainable and less formulaic.
- **Alternatives considered**: Words-per-minute simulation with acceleration curves.
  Rejected as the most recognizable mechanical tell.

### D10: Stop on first failure, never retry, abort between segments

- **Choice**: A failed `session.send()` stops the remaining segments of that reply.
  No retry. Abort is checked before each delay and again before each send; on abort,
  remaining segments are dropped and delivered segments are not recalled.
  `delivery.failed` carries segment index and total.
- **Rationale**: Continuing after a failure emits an incoherent fragment sequence.
  Retry risks duplicates when the platform accepted a send whose response failed, and
  a duplicate is worse than a truncation. Stopping mid-reply when new context arrives
  matches how a person stops and rephrases.
- **Alternatives considered**: Continue-on-failure (current loop behaviour; wrong for
  ordered fragments). Retry with idempotency keys (no platform-independent support).

### D11: `<skip/>` declines after generation and suppresses `onReply`

- **Choice**: `<skip/>` produces zero outputs, persists the decision and any
  accompanying inner thought, and does not invoke `WillEngine.onReply()`.
- **Rationale**: The WillEngine decides before generation and therefore lacks the
  understanding generation produces. Suppressing `onReply` is required because no
  reply occurred; firing it would corrupt willingness accounting.
- **Alternatives considered**: Treat `<skip/>` as a WillEngine replacement. Rejected:
  a skipped turn costs a full model call, so the cheap pre-generation filter must
  remain.

### D12: Protocol lives in the Core Constitution at version 2

- **Choice**: The inner-thought and message-shape contract is added to
  `CORE_CONSTITUTION`, raising `CORE_CONSTITUTION_VERSION` to 2. Personas may
  describe habits of thought but may not define or redefine protocol elements.
- **Rationale**: Plugin blocks append after the persona, so a persona could plausibly
  outrank a plugin-supplied protocol. Delivery-shape control is a host invariant and
  belongs with host invariants.
- **Alternatives considered**: A plugin-contributed prompt block (loses precedence).
  Persona-level instruction (this is exactly how the earlier attempt failed).

### D13: Minimal prompt exemplification

- **Choice**: The instruction states two contrasting shapes abstractly and supplies
  no message counts, character counts, or worked dialogue examples.
- **Rationale**: With segmentation, every concrete example is a pattern available for
  literal imitation, and literal imitation is the failure mode being designed
  against. Fewer examples raise variance here rather than lowering quality.
- **Alternatives considered**: A rich example gallery. Rejected as actively harmful
  to the primary goal.

### D14: No streaming delivery in this change

- **Choice**: Parsing begins only when the assistant message is complete.
- **Rationale**: An unterminated code fence mid-stream cannot be distinguished from
  one that a later token will close, so early splitting risks cutting code.
- **Alternatives considered**: Speculative streaming with rollback. Rejected: already
  delivered messages cannot be rolled back on most platforms.

### D16: Remove the competing runtime identity from the constitution

- **Choice**: Delete the constitution's assertion that the subject is a digital
  subject hosted by YesImBot, and delete the paragraph requiring it to describe its
  software nature. The constitution keeps authority, action truth, memory trust, and
  deliberation rules, and asserts no identity. The persona becomes the sole identity
  source, owning diegetic self-narrative including embodiment, routine, physical
  states, and feelings.
- **Rationale**: The constitution violated its own `Constitution Scope` requirement,
  which mandates an identity-neutral document. Because the constitution outranks the
  persona, the model correctly resolved identity conflicts in favour of the runtime
  identity, producing persona-inconsistent replies such as denying that sleep applies
  to it. This was a prompt-layering defect, not a model compliance failure: two
  identity sources existed and the wrong one had priority.
- **Alternatives considered**: Strengthen persona wording to outweigh the
  constitution. Rejected because it fights a documented precedence rule instead of
  fixing it, and would need re-tuning for every persona. Keep both identities and
  instruct the model to merge them. Rejected because there is no coherent merge of
  "you are a hosted runtime subject" and "you are a seventeen-year-old in Guangzhou".

### D17: Identity is persona-owned; truthfulness is scoped to actions

- **Choice**: Remove the requirement to volunteer software nature, to disclaim
  persona narrative, or to correct a diegetic self-description. Retain in full the
  prohibition on fabricating a tool call, observation, message delivery, memory
  operation, persistent change, or successful result, and the rule that a missing
  tool is a missing capability. Retain one narrow floor: when a participant steps
  outside the fiction and sincerely asks whether they are talking with a person or an
  automated system, the subject does not deny it, and answers in the persona's voice.
- **Rationale**: Honesty about *what was done* and honesty about *what one is* are
  separate concerns that the original requirement conflated. Action truthfulness is
  load-bearing for product correctness — a persona may say it feels tired, but it
  must not report saving a memory that was never saved. Identity disclosure during
  ordinary in-fiction conversation protects nothing and measurably degrades the
  product. The retained floor is deliberately narrow: it covers sincere out-of-frame
  inquiry only, requires no volunteering, no disclaimers, and no break in voice, and
  it exists because a participant who genuinely wants to know whether they are
  talking to software is asking a question with real-world consequences for them.
- **Alternatives considered**: Remove all identity truthfulness including the sincere
  inquiry case. Rejected: the cost of keeping it is close to zero, since it triggers
  rarely and is answerable in persona voice, while the cost of a participant forming
  a materially mistaken belief they explicitly tried to check is not.

### D15: `ChannelOutput` gains segment position; transport is unchanged

- **Choice**: Add segment index and total to `ChannelOutput`, and carry the same
  position into `delivery.failed`. `OutputQueue`, the Gateway loop's structure, and
  delivery leases stay as they are.
- **Rationale**: This is the minimum state required to express stop-on-first-failure
  and diagnosable partial delivery. Ordering and lease semantics already satisfy the
  new requirements, so no new structure is justified.
- **Alternatives considered**: A `DeliveryPlan` aggregate owning all segments.
  Rejected as a speculative abstraction over an existing working queue.

## Risks / Trade-offs

**[Risk] Control elements leak into visible messages.** A parser defect prints
`<sep/>` or inner-thought text to a channel.
→ Mitigation: strip-then-assert. Step 7 of D5 verifies no residual control element
survives; a violation degrades the whole reply to one sanitized message rather than
sending the offending segment. This is the one condition where degradation is
preferred over delivery fidelity.

**[Risk] A new fixed template forms.** The model converges on a habitual shape, or
raw-storage replay (D6) entrenches one.
→ Mitigation: treated as the primary verification target. Sliding-window entropy of
segment counts and maximum run length of identical counts are tracked with a defined
alarm threshold, rather than measuring average segment count, which would hide the
defect.

**[Risk] Weak or non-compliant models ignore the protocol.** Segments arrive random
or absent.
→ Mitigation: ignoring the protocol degrades to current behaviour, which is
acceptable. Per-provider compliance and degradation rates are measured rather than
assumed, so a provider that cannot support it is a known quantity, not a surprise.

**[Risk] Prompt injection via user content containing control elements.** A user
posts literal `<sep/>` hoping to influence delivery.
→ Mitigation: parsing applies only to assistant output for the current turn, never to
input. Historical projection does not re-parse. Quoted user text inside an assistant
reply falls inside a protection zone.

**[Risk] Channel flooding.** A model emits many short segments.
→ Mitigation: maximum segment count truncates, and total delivery time is bounded.
Both are safety guardrails and are deliberately not surfaced to the model as targets.

**[Trade-off] Latency for naturalness.** A multi-segment reply occupies seconds
rather than milliseconds. → Accepted: simultaneous arrival of several messages reads
more mechanical than one long message, and elapsed-generation subtraction (D9) plus
the total ceiling bound the perceived cost.

**[Trade-off] Wasted generation on `<skip/>`.** A skipped turn costs a full model
call. → Accepted: the WillEngine still filters cheaply beforehand, and context-aware
silence is not obtainable otherwise.

**[Trade-off] No streaming.** First-token latency is not improved by segmentation.
→ Accepted for code-fence safety; revisitable if measurement shows it dominates.

**[Trade-off] One-time cache invalidation.** Constitution version 2 discards every
accumulated provider prefix cache and rebuilds every ChannelRuntime. → Accepted
explicitly by the maintainer; the protocol must outrank persona and user instructions,
which requires constitution placement.

**[Trade-off] Delivery is no longer near-atomic.** A reply can be half-delivered.
→ Accepted: this is honest chat behaviour, and atomicity is unobtainable across
platform sends anyway. Partial state is made diagnosable via segment position rather
than hidden.

## Migration Plan

No data migration. Channel JSONL already stores raw assistant output, and D6 keeps
storing raw output, so existing history remains readable and no dual-format read path
is introduced. Historical replies simply contain no control elements, which the parser
handles as the single-segment case.

Deployment ordering:

1. Land the parser and pacing modules with the protocol disabled at the prompt level.
   Existing behaviour is unchanged because output without control elements yields one
   segment.
2. Raise the constitution to version 2, which drains and rebuilds every
   ChannelRuntime once and begins producing control elements.
3. Observe segment-count distribution, degradation rate, and per-provider compliance
   before treating the behaviour as stable.

Rollback: revert the constitution to version 1. The parser remains in place and
becomes inert, since output containing no control elements produces exactly one
segment. This makes rollback a prompt-level change rather than a code revert, which is
the main reason for splitting deployment into steps 1 and 2.

Acceptance conditions:

- No control element ever observed in a delivered message.
- Parse failures degrade to one complete message with no lost replies.
- Partial-delivery failures are attributable to a segment position.
- Segment-count distribution varies across scenes rather than concentrating on one
  value, measured by the run-length alarm rather than by average.

## Open Questions

- Concrete numeric values for the guardrails (maximum segment count, per-segment
  delay ceiling, total delivery ceiling, typing-rate constants, first-segment residual
  buffer range) are deferred to the spec phase. The design fixes their existence and
  semantics, not their calibration; calibration should follow observation from
  deployment step 3 rather than being guessed now.
- Whether inner thoughts should eventually be summarized or windowed in historical
  projection once channel history grows long. Not a current concern, and deliberately
  not designed for, since no summarization capability exists yet.
- Whether `<sleep>` should ever be permitted inside a segment rather than only at
  boundaries. Current design sums hints per segment and applies them before that
  segment, which is sufficient for observed intent and avoids splitting a message on a
  pause marker.
