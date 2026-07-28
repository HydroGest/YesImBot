# Brainstorm

Options explored before settling on the direction in `design.md`. Evidence cited
here lives in `review.md`; decisions live in `design.md`. This document records
only what was considered and why it was set aside.

## Problem framing

Two framings were available for the reply parser.

1. *The parser is fine, the plan's `h` instruction is wrong.* Supported by the
   measurement that `h.parse` mangles unguarded LLM text (`review.md` §7.1).
2. *The parser is reimplementing a lexer, and the real gap is that the host is
   guessing which `<` characters are markup.* Supported by the fact that
   protection zones are heuristics over fenced code, inline code, and URLs, and
   can never be complete.

Framing 2 was chosen. Framing 1 preserves 172 lines of interval algebra and keeps
the host guessing forever; framing 2 moves the decision to the only party that
knows the answer — the model that produced the text.

## Reply parsing alternatives

### A1. Keep the regex parser, drop only the dead fields

Delete `degraded`, `innerThought`, `maxSegments`; keep protection ranges and
escape handling. ~150 lines removed.

Rejected: leaves the parser reimplementing element recognition, keeps
`unescapeControlText` that `h.parse` provides natively, and keeps segments as
plain text so replies can never contain `<at>` or images. Cheapest option but
buys the least.

### A2. Full `h.parse`, no `<raw>`, recover unknown elements

Parse everything with `h`; treat any element outside a whitelist as literal text
and reconstruct it.

Rejected as a *primary* mechanism: recovery is provably partial. `a < b and 3 > 2`
collapses into `template` attributes with order and whitespace lost
(`review.md` §7.3), so some inputs cannot be restored at all. Retained as a
*fallback* — see `design.md` D3.

### A3. `<raw>` parsed by `h`, then re-serialize its children

Let `h.parse` handle the whole string, locate `raw` elements in the tree, and
join their children back to text.

Rejected on measurement: 3/10 fidelity joining `toString()`, 2/10 taking text
content, and 0/10 on any input containing `<` (`review.md` §7.3). Two failures are
structural rather than incidental — closing tags are injected that never existed
in the source, and the `</raw>` boundary itself is absorbed into an attribute, so
the region's end cannot be located. `toString` is not the inverse of `parse`.

### A4. `<raw>` pre-extracted before parsing, then restored (chosen)

Scan out raw regions with `indexOf`, substitute a per-parse nonce, parse the
remainder with `h`, restore captured substrings into text nodes.

Chosen: lossless on all tested inputs (`review.md` §7.4) while leaving all real
message structure to `h`. The pre-pass is a plain string scan, not a parser, so it
does not reintroduce what A1 was rejected for. Ordering is a correctness
requirement, not a preference: the substring must be captured before lexing,
because that is the last point at which it still exists intact.

### A5. Ask the model for JSON instead of an element stream

Rejected: discards Koishi element syntax the platform layer already speaks,
requires the model to escape its own content inside JSON strings (the same class
of problem one level down), and makes `<at>`/image emission harder rather than
easier.

## Segmentation source

Considered removing `<sep/>` and having the host infer split points from
punctuation or length.

Rejected: prior art in this repository already failed this way — a fixed host
weighting replaced one rigid template with another, and the recorded failure mode
was pattern repetition rather than absence of splitting. Model-authored splits
keep the variation where the judgement is. `<sep/>` is retained.

## Willingness engine

Considered deleting the scoring engine outright, since 233 lines and 10+ knobs
resolve to one boolean and its branches are reachable only by writing private
fields in tests (`review.md` §6.3).

Rejected by product decision: probabilistic participation is a required
capability, and simple routing does not meet the need. A single
`groupReplyChance` probability was also considered as a replacement and rejected
for the same reason — it cannot express decay or accumulated interest.

Consequently the `WillEngine` interface is also retained: with routing and
willingness both present, it has two real implementations and is not a
speculative abstraction. An earlier suggestion to collapse it is withdrawn.

What remains in scope is narrower: validate configuration once instead of per
call, stop exporting `decayScore` for tests, and de-duplicate `isSelfMention`.

## Detecting a delivered reply

Considered keeping the `ReplyCompletion` three-state reconciler on the grounds
that willingness is retained and `onReply` still matters.

Rejected: the `eligibility` dimension asks whether the turn produced renderable
content, but Gateway acknowledges only after a successful `session.send()` of a
segment that exists (`review.md` §5.2). Acknowledgement already implies
eligibility. A set of acknowledged turn ids expresses the same guarantee.

## `text` removal

Considered keeping `MessageRecord.text` as a render cache and merely fixing the
divergence by deriving it from sealed elements.

Rejected: measurement put full-history rendering at 0.947 ms per turn, about 0.02%
of a model call, with deterministic and reparse-stable output (`review.md` §4). A
cache that cheap is not worth a second field that can disagree with the first.
Keeping both fields would also preserve the text round-trip in asset selection.

Memoization per message id was considered as a middle path and deferred: there is
no measured pressure, and adding it now would be speculative.

## Pacing

Considered restoring the plan's `random: () => number` injection to make delays
deterministic under test.

Rejected: it exists only to serve tests, and the module is small enough to verify
by asserting bounds and monotonicity. `Math.random()` stays internal. Tests
assert ranges instead of exact values.

## Module split scope

Considered leaving `runtime/index.ts` intact and only deleting the reconciler.

Rejected: three unrelated concerns and three copies of the same scheduler remain,
and the fixture weight in tests follows directly from that coupling. The split is
justified by differing reasons to change — orchestration, per-channel session,
transport — not by file length.

Also considered extracting `OutputQueue` into a shared utility package. Deferred:
one consumer, no second caller, so it stays local to the delivery module.
