# Design

Technical decisions for this change. Findings and measurements are in
`review.md`; rejected alternatives are in `brainstorm.md`. This document states
only the chosen design and its consequences.

## Context

`core` is a Koishi plugin whose reply path is about to grow to support natural
message segmentation. The review found the current reply parser reimplements
element recognition that Koishi's `h` API provides, carries three output fields
with no production consumer, and depends on heuristic protection zones that
cannot be made complete. Separately, `MessageRecord` persists two fields that
disagree about whether an image was frozen.

Constraints:

- Breaking changes are acceptable. No compatibility branch, migration reader,
  alias, or dual payload shape is added. Existing JSONL stays on disk unread,
  consistent with prior practice in this repository.
- The willingness engine and its tuning surface are retained by product decision.
- Koishi `h` is the parsing mechanism for reply structure.

## Goals / Non-Goals

**Goals:**

- Make `h.parse()` the single owner of reply message structure.
- Give the model an explicit way to emit verbatim text, replacing host guesswork.
- Make `elements` the single source of truth for persisted messages.
- Delete every output field, config knob, helper, and seam with no real consumer.
- Reduce validation to the two genuinely untrusted boundaries.
- Split `runtime/index.ts` along its three real seams.

**Non-Goals:**

- Redesigning `@yesimbot/agent-runtime`.
- Changing willingness scoring behaviour or its tuning surface.
- Changing channel identity, storage layout, or the assignee admission model.
- Introducing a diagnostics or observability layer for reply parsing.
- Memoizing text projection.
- Moving the OneBot adapter out of `core`.

## Decisions

### D1: `h.parse()` owns reply structure; `<raw>` is pre-extracted

**Choice.** `parseReply` runs a fixed five-stage pipeline:

1. Scan out `<raw>…</raw>` regions with `indexOf`, replacing each with a
   per-parse nonce placeholder token.
2. `h.parse()` the remaining source.
3. Discard `<inner_thought>` subtrees.
4. Partition the tree on `<sep/>` elements into ordered segments.
5. Restore captured raw substrings into text nodes.

Output is `Element[][]` — ordered segments of elements.

**Rationale.** Stages 2-4 are exactly what `h` is good at: recognizing elements,
handling `&lt;sep/&gt;` as literal text natively, and giving a tree to partition
instead of character offsets to reconcile. Stage 1 exists because `h.parse` has no
raw mode and destroys raw boundaries when inner markup appears.

**Ordering is a correctness requirement.** Stage 1 must precede stage 2. The
captured substring is the only representation of the author's literal text that
still exists intact; after lexing, whitespace inside tags, attribute order and
quoting, self-closing form, and the markup/literal distinction are gone, and the
`</raw>` boundary may itself have been absorbed into an attribute.

**Nonce.** Generated per parse call, not per process. A fixed token would let a
model emit the placeholder and inject arbitrary content into another region.
Placeholder substitution happens only inside text nodes.

### D2: Reply control grammar is `<inner_thought>`, `<sep/>`, `<raw>`

**Choice.** Three control elements.

- `<inner_thought>…</inner_thought>` — private deliberation. Required of the
  model to improve output quality, removed from delivery, retained verbatim in
  JSONL and replayed to the model as its own history. Parsed and discarded; not
  returned as a field.
- `<sep/>` — a model-authored boundary between delivered messages.
- `<raw>…</raw>` — verbatim plain text. Contents are neither parsed nor escaped.

Any other element passes through as reader-visible content. No persona, plugin,
tool result, memory, or user message may define, redefine, extend, or disable a
control element.

**Rationale.** `<raw>` replaces protection zones over fenced code, inline code,
and URLs with an explicit statement of intent. The host cannot know whether `<`
was markup or literal text; the model can. Removing the heuristic also removes an
open-ended maintenance obligation — every new false positive would otherwise
demand another protection rule.

**Consequence for prompts.** The constitution must teach `<raw>`: wrap plain-text
content that may contain `<`, `>`, or code in `<raw>`. This is a new obligation on
the model and the principal risk of this change (R1).

### D3: Unrecognized elements are recovered as literal text with a warning

**Choice.** When the tree contains an element outside the recognized set —
control elements plus the platform elements Core already handles — Core
reconstructs it as literal text in place and emits one `logger.warn` identifying
the element type.

**Rationale.** If the model omits `<raw>` around `List<String>`, `h.parse` yields a
`String` element and the surrounding text would otherwise be silently relocated or
dropped. Literal recovery keeps the reply intact for the common single-tag case.

**Known limit, accepted.** Recovery is partial by construction. Inputs like
`a < b and 3 > 2` collapse into element attributes with order and whitespace lost,
and cannot be restored. This is the residual cost of choosing `h` over character
scanning; `<raw>` is the mechanism that avoids it, and the warning is what makes
omissions visible so the prompt can be corrected.

**Not a degradation mode.** The reply is still delivered as parsed. There is no
`degraded` field, no fallback to a single message, and no diagnostics structure —
one log line, and the prompt is the fix.

### D4: `ReplyPlan`, `degraded`, and `maxSegments` are deleted

**Choice.** `parseReply(raw: string): Element[][]`. No wrapper type, no
degradation enum, no segment maximum, no `try/catch` degradation path.
`reply.segmentation` is removed from configuration.

**Rationale.** Only `segments` was ever read in production. A truncation guardrail
whose signal nothing reads is a silent reply truncation. Deleting the enum also
deletes `findProtectedRanges`, `isProtected`, `findControls`, `stripControls`,
`hasRecognizedControl`, and `unescapeControlText`.

Bounding still exists where it belongs: pacing's total-delay ceiling (D7) limits
how long a multi-segment reply can occupy the channel.

### D5: `elements` is the single source of truth; `MessageRecord.text` is deleted

**Choice.** Gateway persists **sealed** elements in `MessageRecord.elements`.
`MessageRecord.text` and `ResolvedMessageDraft.text` are removed. Model projection
renders text from persisted elements on demand.

`EventRecord.text` is **retained**: Events carry no `elements`, so `text` is their
only content. This is a real difference in kind, not an inconsistency.

**Rationale.** Removes the divergence at its source rather than papering over it,
at a measured cost of ~0.02% of a model call with deterministic, reparse-stable
output. Sealing at ingress makes rendering a pure function of persisted data.

**Consumer migration.**

| Consumer | Change |
| --- | --- |
| `event/formatter.ts` | Render header + text from `data.elements` at projection time. |
| `media/selectInputFiles` | Walk `data.elements` for asset ids; delete `imageAssetIds` and its `h.normalize` text round trip. |
| `will/willingness.ts` | Match keywords against text joined from element text nodes. |

**Side effects.** `sealElements` becomes the single ingress call site, so Gateway's
redundant outer `normalizeElements` is removed. The triplicated text derivation at
`gateway/index.ts:328`, `gateway/index.ts:355`, and `platforms/onebot/index.ts:33`
collapses into one projection-time renderer.

### D6: Willingness is retained; only its redundancies are removed

**Choice.** Keep the scoring engine, all tuning knobs, and the `WillEngine`
interface. Change three things:

- Call `assertValidConfig` once in the constructor instead of on every `decide()`
  and `onReply()`.
- Stop exporting `decayScore`; make it module-internal.
- Keep one `isSelfMention`, deleting the duplicate.

**Rationale.** Probabilistic participation is a required capability and routing
does not cover it. With two real implementations behind it, `WillEngine` is a
justified seam; an earlier suggestion to remove it is withdrawn. The config is
frozen at construction, so per-call revalidation cannot detect anything new.

### D7: Delivery acknowledgement replaces the reply reconciler

**Choice.** Replace `ReplyCompletion` with a set of acknowledged turn ids. On
`complete(turnId)`, if the turn is not already in the set, add it and call
`will.onReply()` once. Release removes the entry. `hasRenderableSegment` is
deleted. The dedicated `enqueueReplyCompletion` chain is removed.

**Rationale.** Gateway acknowledges only after a successful `session.send()` of a
segment that exists, so acknowledgement already proves a reply reached the
channel. The `eligibility` dimension re-derived that fact by re-parsing output the
same turn had already parsed. Scoring semantics are unchanged: exactly one
`onReply()` per delivered reply.

### D8: Pacing keeps two knobs and no injected randomness

**Choice.** `PacingInput` becomes `{ text, consumedDeliveryMs, config }`.
Configuration is `charactersPerSecond` and `maxTotalDelayMs`. Jitter range,
CJK/Latin split, and minimum delay become module constants. `normalizeLimits`,
`nonNegative`, and `positive` are deleted. The first-segment generation-time
compensation branch is deleted; all segments are treated uniformly.
`Math.random()` stays internal.

**Rationale.** Koishi Schema already constrains these values, making the third
validation layer unreachable. The first-segment branch encoded an unverified
latency assumption. Tests assert bounds and monotonicity, which is sufficient for
a function this size and avoids a seam that exists only for tests.

Segment text length is computed from the segment's element text nodes, since
segments are now `Element[]`.

### D9: Validation only at untrusted boundaries

**Choice.** Two validation points:

- **Session ingress** — normalize and whitelist platform input in Gateway.
- **JSONL read-back** — one zod parse, following the pattern already used in
  `storage/manifest.ts`.

Delete `containsReference`, `isRecord`, `hasScope`. Narrow `isMessage`/`isEvent`
to the read-back path; model projection discriminates on the custom message
`type` instead of re-checking fields.

**Rationale.** These helpers validate values Core constructed from literals in the
same file. `hasScope` compares fields against the scope they were assigned from
and is always true. `containsReference` enforces an architectural invariant — no
`Session` in a persisted record — by deep-walking every inbound message; that
invariant belongs in a test.

### D10: Runtime splits into three modules with one scheduler

**Choice.** Split `runtime/index.ts` into `runtime/manager.ts` (cross-channel
lifecycle), `runtime/channel.ts` (per-channel FIFO and Agent assembly), and
`runtime/delivery.ts` (leases, abort signals, output queue). Extract one concrete
`serialQueue` helper replacing the three duplicated promise-chain schedulers.
Delete the `createChannelRuntime` option.

**Rationale.** The three concerns change for different reasons and can be tested
independently. `createChannelRuntime` exists only so tests can substitute a fake
`ChannelRuntime`; once delivery is separable, the real object is constructible in
a test and the seam is unnecessary. This is a boundary split, not a line-count
split.

### D11: Housekeeping

- Merge `model/` from six files into `model/service.ts` and `model/provider.ts`;
  complete the barrel as the single entry point; delete `isModelId`,
  `EmbeddingModelRef`, `ProviderPluginOptions`, and the single-shape
  `ModelProvider`/`ModelProviderCapabilities` interfaces.
- Move `constitution.ts` and `athena.ts` prose into packaged Markdown resources
  read through the existing prompt-file path.
- Convert `createImageFreezer` to a class; delete the unreachable branch in
  `reportAssetFailure`.
- Delete `core/src/path.ts`, inlining `path.resolve`.
- Correct `AGENTS.md`: the OneBot adapter lives in `core/src/platforms/onebot/`
  and there is no `platforms/*` package layout; remove `plugins/sticker`.
  `registerResolver()` remains as the extension point for third-party platform
  packages.

## Risks / Trade-offs

[Risk] The model omits `<raw>` and content containing `<` is mangled. This is the
principal new failure mode. → Mitigation: literal recovery plus a warning (D3),
an explicit constitution instruction (D2), and tests covering common shapes
(generics, comparisons, code fences, emails).

[Risk] Literal recovery cannot restore attribute-collapsed inputs such as
`a < b and 3 > 2`. → Mitigation: none available within an element-based parser;
accepted as the cost of D1. The warning makes occurrences visible so the prompt
can be tightened.

[Trade-off] Reply structure now depends on Koishi's parser behaviour rather than
Core's own scanner. Accepted: it is the platform's own syntax, the alternative
duplicates a lexer, and the `<raw>` pre-pass covers the one case `h` cannot.

[Trade-off] Text is rendered per projection instead of cached. Accepted on
measurement (0.947 ms per 200-message history), with memoization available later
if pressure appears.

[Risk] Deleting `MessageRecord.text` changes the persisted payload; older JSONL
records are not readable as current records. → Mitigation: consistent with
existing practice — old files remain on disk unread, with no migration or dual
read. Bump the message schema version so read-back fails loudly rather than
silently misinterpreting.

[Trade-off] Segments become `Element[]`, so delivery passes structured content to
`session.send()` rather than a string. Accepted: it is what enables `<at>` and
images in replies, and Koishi already accepts a fragment.

[Risk] Splitting the runtime touches concurrency-sensitive code (FIFO ordering,
delivery leases, drain). → Mitigation: sequence it after the deletions in D4/D7
so there is less surface to move, and keep existing lifecycle tests as the
contract.

## Migration Plan

Recommended sequencing. Each step is independently verifiable; the dependencies
noted are real.

1. **Reply parsing** (D1-D4) — `<raw>` pre-extraction, `h`-based parsing, literal
   recovery, delete `ReplyPlan`/`degraded`/`maxSegments`, update the constitution.
2. **Delete `text`** (D5) — independent of step 1; may proceed in parallel.
3. **Pacing** (D8) — depends on step 1 for `Element[]` segments.
4. **Validation** (D9) — depends on step 2.
5. **Willingness and acknowledgement** (D6, D7).
6. **Runtime split** (D10) — depends on step 5.
7. **Housekeeping** (D11) — including the `AGENTS.md` correction.

Acceptance: `yarn turbo run check-types --filter=koishi-plugin-yesimbot`, the
package test suite, and `yarn build` pass at each step. Reply behaviour is
verified against the shapes in `review.md` §7 — generics, comparisons, code
fences, escaped control text, `<at>` passthrough, and multi-segment splitting.

Rollback: revert per step. No data migration is performed, so rollback needs no
data repair; JSONL written after step 2 is not readable by pre-change code, which
the schema version bump makes explicit.

## Open Questions

None blocking. Two decisions were resolved during review and are recorded here so
they are not reopened without new information: `<sep/>` is retained as the
segmentation source, and the willingness engine is retained with its tuning
surface intact.
